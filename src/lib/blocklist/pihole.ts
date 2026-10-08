/**
 * Fetches and parses a Pi-hole compatible blocklist into a deduplicated, lowercase set of hostnames, then applies the account's per-list entry limit using the user's chosen overflow strategy.
 *
 * Accepted line formats (mirrors what Pi-hole's `gravity` accepts, @link https://docs.pi-hole.net/database/gravity/):
 * - hosts file: `0.0.0.0 example.com`, `127.0.0.1 example.com`, `:: example.com` (any leading IP is dropped; every following token is a hostname)
 * - plain domain list: `example.com`
 * - Adblock-style exact matches: `||example.com^` (Pi-hole only honors this one ABP form - no other ABP modifiers are supported, and lines using them are skipped)
 * - `#` and `!` comments, inline or whole-line, and `[Adblock Plus ...]` headers
 *
 * Cloudflare Gateway hostname lists don't support wildcards (@link https://developers.cloudflare.com/cloudflare-one/reusable-components/lists/), which matches Pi-hole's exact-match semantics here - Gateway's `dns.domains`/`http.request.domains` selectors already match a listed domain and all of its subdomains.
 */

export const OVERFLOW_STRATEGIES = ['first', 'last', 'sortedFirst', 'sortedLast', 'random'] as const;
export type OverflowStrategy = (typeof OVERFLOW_STRATEGIES)[number];

/** Hard cap on the decoded response size - the parse keeps every unique hostname in memory, and Workers have a 128 MiB isolate heap. Real-world Pi-hole lists are single-digit MiB; anything past this is almost certainly not a blocklist. */
export const MAX_BLOCKLIST_BYTES = 64 * 1024 * 1024;

/** Hostnames that appear in nearly every hosts-format list but are never meaningful to block upstream. */
const IGNORED_HOSTNAMES = new Set(['localhost', 'localhost.localdomain', 'local', 'broadcasthost', 'ip6-localhost', 'ip6-loopback', 'ip6-localnet', 'ip6-mcastprefix', 'ip6-allnodes', 'ip6-allrouters', 'ip6-allhosts', '0.0.0.0']);

/** RFC 1123 hostname with at least one label separator. Underscores are tolerated since real tracker subdomains use them, and Gateway accepts them. Non-ASCII input is normalized to punycode first (see `normalizeHostname`), so only ASCII reaches this check. */
const HOSTNAME_PATTERN = /^(?=.{1,253}$)(?:[a-z0-9_](?:[a-z0-9_-]{0,61}[a-z0-9_])?\.)+[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;
const IPV4_PATTERN = /^\d{1,3}(?:\.\d{1,3}){3}$/;
const ABP_EXACT_PATTERN = /^\|\|([^\s/^|*$]+)\^$/;
const TITLE_PATTERN = /^\s*[#!]\s*title\s*:\s*(.+?)\s*$/i;
/** Only the leading comment block is scanned for a title - a `# Title:` buried thousands of lines down is somebody else's section header. */
const TITLE_SCAN_LINES = 100;

export class BlocklistFetchError extends Error {
	constructor(
		public readonly code: 'http' | 'too-large' | 'empty' | 'network',
		message: string,
	) {
		super(message);
		this.name = 'BlocklistFetchError';
	}
}

export interface FetchedBlocklist {
	/** `# Title: ...` / `! Title: ...` from the header comments (StevenBlack, hagezi, OISD, AdGuard and most ABP-style lists carry one), when present. Pi-hole itself ignores it; here it names the Cloudflare list. */
	title: string | undefined;
	/** The hostnames to upload, already limited and ordered per the overflow strategy. */
	domains: string[];
	/** Unique valid hostnames found in the source before the limit was applied. */
	sourceCount: number;
}

function isIpLiteral(token: string) {
	return IPV4_PATTERN.test(token) || token.includes(':');
}

/** Lowercases, strips a trailing dot, converts non-ASCII labels to punycode (Gateway does this server-side anyway and treats the two spellings as duplicates - doing it here keeps the dedupe exact). Returns `undefined` for anything that isn't a plausible public hostname. */
function normalizeHostname(raw: string): string | undefined {
	let hostname = raw.trim().toLowerCase();
	if (hostname.endsWith('.')) hostname = hostname.slice(0, -1);
	if (hostname.length === 0 || IGNORED_HOSTNAMES.has(hostname) || isIpLiteral(hostname)) return undefined;

	// eslint-disable-next-line no-control-regex
	if (/[^\x00-\x7f]/.test(hostname)) {
		try {
			hostname = new URL(`http://${hostname}`).hostname;
		} catch {
			return undefined;
		}
	}

	return HOSTNAME_PATTERN.test(hostname) ? hostname : undefined;
}

/** Yields every hostname candidate on one source line (zero for comments/blank/unsupported syntax). */
function* hostnamesOnLine(line: string): Generator<string> {
	const commentStart = line.search(/[#!]/);
	const content = (commentStart === -1 ? line : line.slice(0, commentStart)).trim();
	if (content.length === 0 || content.startsWith('[')) return;

	const abpMatch = ABP_EXACT_PATTERN.exec(content);
	if (abpMatch?.[1]) {
		yield abpMatch[1];
		return;
	}
	// Any other Adblock syntax (`||x^$third-party`, `@@`, element hiding, ...) is unsupported by Pi-hole too.
	if (content.includes('|') || content.includes('^') || content.includes('@@')) return;

	const tokens = content.split(/\s+/);
	const [first] = tokens;
	if (first !== undefined && isIpLiteral(first)) tokens.shift();

	yield* tokens;
}

async function* decodedLines(body: ReadableStream<BufferSource>): AsyncGenerator<string> {
	let carry = '';
	let bytesSeen = 0;

	for await (const chunk of body.pipeThrough(new TextDecoderStream())) {
		bytesSeen += chunk.length;
		if (bytesSeen > MAX_BLOCKLIST_BYTES) throw new BlocklistFetchError('too-large', `Blocklist exceeds ${MAX_BLOCKLIST_BYTES} bytes`);

		const lines = (carry + chunk).split(/\r?\n/);
		carry = lines.pop() ?? '';
		yield* lines;
	}

	if (carry.length > 0) yield carry;
}

export interface FetchBlocklistOptions {
	userAgent: string;
	limit: number;
	overflow: OverflowStrategy;
	signal: AbortSignal;
}

/**
 * The whole response is always read and deduplicated before the limit is applied - even for `first` - so `sourceCount` is exact and the user can see how much a list is being truncated. The streaming line parse keeps peak memory to the hostname set itself rather than the raw body plus its split copy.
 *
 * In production, `global_fetch_strictly_public` (wrangler.json) makes the runtime refuse private/internal destinations outright. Local `vite` dev has no such guard - acceptable for a dev-only loopback.
 */
export async function fetchPiholeBlocklist(url: string, { userAgent, limit, overflow, signal }: FetchBlocklistOptions): Promise<FetchedBlocklist> {
	let response: Response;
	try {
		response = await fetch(url, {
			headers: { 'user-agent': userAgent, accept: 'text/plain, */*;q=0.5' },
			redirect: 'follow',
			signal,
		});
	} catch (err) {
		throw new BlocklistFetchError('network', err instanceof Error ? err.message : String(err));
	}

	if (!response.ok || !response.body) throw new BlocklistFetchError('http', `Blocklist responded with HTTP ${response.status}`);

	const unique = new Set<string>();
	let title: string | undefined;
	let lineNumber = 0;
	for await (const line of decodedLines(response.body)) {
		if (title === undefined && lineNumber++ < TITLE_SCAN_LINES) title = TITLE_PATTERN.exec(line)?.[1];

		for (const candidate of hostnamesOnLine(line)) {
			const hostname = normalizeHostname(candidate);
			if (hostname) unique.add(hostname);
		}
	}

	if (unique.size === 0) throw new BlocklistFetchError('empty', 'No valid hostnames found in the blocklist');

	const all = Array.from(unique);
	if (all.length <= limit) return { title, domains: all, sourceCount: all.length };

	// Source order is preserved for `first`/`last` so a stable upstream list produces a stable Cloudflare list across refreshes; the sorted variants use plain code-unit order, which is what you'd expect for lowercase ASCII hostnames and far cheaper than `localeCompare` over a million entries.
	let domains: string[];
	switch (overflow) {
		case 'first':
			domains = all.slice(0, limit);
			break;
		case 'last':
			domains = all.slice(-limit);
			break;
		case 'sortedFirst':
			domains = [...all].sort().slice(0, limit);
			break;
		case 'sortedLast':
			domains = [...all].sort().slice(-limit);
			break;
		case 'random': {
			// Partial Fisher-Yates: only the first `limit` positions need settling. Not security-relevant, so `Math.random` is fine.
			const pool = [...all];
			for (let index = 0; index < limit; index++) {
				const swapWith = index + Math.floor(Math.random() * (pool.length - index));
				[pool[index], pool[swapWith]] = [pool[swapWith]!, pool[index]!];
			}
			domains = pool.slice(0, limit);
			break;
		}
	}

	return { title, domains, sourceCount: all.length };
}
