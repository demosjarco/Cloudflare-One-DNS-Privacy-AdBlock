/**
 * Builds and parses the `traffic` wirefilter expression for this app's managed DNS/HTTP rules.
 *
 * Selector names verified against Cloudflare's live docs (not just the SDK's opaque `traffic: string` type):
 * - DNS content categories: `any(dns.content_category[*] in {<id> <id>})`
 * - HTTP content categories: `any(http.request.uri.content_category[*] in {<id> <id>})`
 * - DNS domain-in-list: `any(dns.domains[*] in $<LIST_UUID>)` (confirmed via a Cloudflare docs curl example)
 * - HTTP domain-in-list: `any(http.request.domains[*] in $<LIST_UUID>)` - inferred by analogy to the DNS form,
 *   not directly observed. Lists aren't wired up yet (`listIds` is always `[]` today); verify this form empirically
 *   against a real `rules.list()` read-back once list management exists.
 * - DNS location scope (DNS only): `dns.location in {"uuid1" "uuid2"}`
 *
 * @link https://developers.cloudflare.com/cloudflare-one/traffic-policies/dns-policies/
 * @link https://developers.cloudflare.com/cloudflare-one/traffic-policies/http-policies/
 */
export type PolicyKind = 'dns' | 'http';

export interface PolicySelection {
	categoryIds: number[];
	/** Reusable hostname-list IDs to OR in - always `[]` until list management ships. */
	listIds: string[];
	/** DNS only; ignored for `kind === 'http'`. An empty array means "all locations" (no `dns.location` clause at all). */
	locationIds: string[];
}

function contentCategoryField(kind: PolicyKind) {
	return kind === 'dns' ? 'dns.content_category' : 'http.request.uri.content_category';
}

function domainsField(kind: PolicyKind) {
	return kind === 'dns' ? 'dns.domains' : 'http.request.domains';
}

/** `undefined` means the selection is empty and must not be sent to Cloudflare as a `traffic` string - callers must treat this as "select at least one category (or list)". */
export function buildTraffic(kind: PolicyKind, selection: PolicySelection): string | undefined {
	const clauses: string[] = [];

	if (selection.categoryIds.length > 0) clauses.push(`any(${contentCategoryField(kind)}[*] in {${selection.categoryIds.join(' ')}})`);
	for (const listId of selection.listIds) clauses.push(`any(${domainsField(kind)}[*] in $${listId})`);

	if (clauses.length === 0) return undefined;

	const combined = clauses.length === 1 ? clauses[0]! : clauses.map((clause) => `(${clause})`).join(' or ');

	if (kind === 'dns' && selection.locationIds && selection.locationIds.length > 0) {
		return `(${combined}) and dns.location in {${selection.locationIds.map((id) => `"${id}"`).join(' ')}}`;
	}

	return combined;
}

/**
 * Best-effort read-back of a `traffic` string this app itself generated (via {@link buildTraffic}) into its structured selection, so the UI can reflect what's actually configured on Cloudflare's side rather than only the create-time intent.
 *
 * Cloudflare reformats/sanitizes expressions server-side, so this only recognizes the shapes {@link buildTraffic} produces - anything it doesn't recognize (e.g. a human hand-edited the policy in the dashboard into something else) is simply not extracted rather than mis-parsed.
 */
export function parseTraffic(kind: PolicyKind, traffic: string | undefined | null): PolicySelection {
	const categoryIds: number[] = [];
	const listIds: string[] = [];
	const locationIds: string[] = [];

	if (traffic) {
		const categoryMatch = new RegExp(String.raw`any\(${contentCategoryField(kind).replaceAll('.', String.raw`\.`)}\[\*\]\s+in\s+\{([^}]*)\}\)`).exec(traffic);
		if (categoryMatch?.[1]) {
			for (const idText of categoryMatch[1].trim().split(/\s+/)) {
				const id = Number(idText);
				if (Number.isFinite(id)) categoryIds.push(id);
			}
		}

		const listMatches = traffic.matchAll(new RegExp(String.raw`any\(${domainsField(kind).replaceAll('.', String.raw`\.`)}\[\*\]\s+in\s+\$([\w-]+)\)`, 'g'));
		for (const match of listMatches) if (match[1]) listIds.push(match[1]);

		if (kind === 'dns') {
			const locationMatch = /dns\.location\s+in\s+\{([^}]*)\}/.exec(traffic);
			if (locationMatch?.[1]) {
				for (const quoted of locationMatch[1].matchAll(/"([^"]*)"/g)) if (quoted[1]) locationIds.push(quoted[1]);
			}
		}
	}

	return { categoryIds, listIds, locationIds };
}
