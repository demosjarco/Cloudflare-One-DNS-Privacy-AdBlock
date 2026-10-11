/**
 * Builds and parses the `traffic` wirefilter expression for this app's managed DNS/HTTP rules.
 *
 * Selector names verified against Cloudflare's live docs (not just the SDK's opaque `traffic: string` type):
 * - DNS content categories: `any(dns.content_category[*] in {<id> <id>})`
 * - HTTP content categories: `any(http.request.uri.content_category[*] in {<id> <id>})`
 * - DNS security categories: `any(dns.security_category[*] in {<id> <id>})`
 * - HTTP security categories: `any(http.request.uri.security_category[*] in {<id> <id>})` (verbatim in Cloudflare's own
 *   "All-HTTP-SecurityRisks-Blocklist" curl example, see the learning-path link below)
 * - DNS domain-in-list: `any(dns.domains[*] in $<LIST_UUID>)` (confirmed via a Cloudflare docs curl example)
 * - HTTP domain-in-list: `any(http.request.domains[*] in $<LIST_UUID>)` (verbatim in Cloudflare's own
 *   "All-HTTP-DomainHost-Blocklist" curl example, see the learning-path link below)
 * - DNS location scope (DNS only): `dns.location in {"uuid1" "uuid2"}`
 *
 * @link https://developers.cloudflare.com/cloudflare-one/traffic-policies/dns-policies/
 * @link https://developers.cloudflare.com/cloudflare-one/traffic-policies/http-policies/
 * @link https://developers.cloudflare.com/learning-paths/secure-internet-traffic/build-http-policies/recommended-http-policies/
 */
export type PolicyKind = 'dns' | 'http';

export interface PolicySelection {
	/** Content category IDs - matched with the `content_category` selector. */
	categoryIds: number[];
	/** Security category IDs - Gateway matches these with a separate `security_category` selector; putting them in the `content_category` set never matches. */
	securityCategoryIds: number[];
	/** Reusable hostname-list IDs (this app's synced lists, see `lists.ts`) to OR in alongside the categories. */
	listIds: string[];
	/** DNS only; ignored for `kind === 'http'`. An empty array means "all locations" (no `dns.location` clause at all). */
	locationIds: string[];
}

function contentCategoryField(kind: PolicyKind) {
	return kind === 'dns' ? 'dns.content_category' : 'http.request.uri.content_category';
}

function securityCategoryField(kind: PolicyKind) {
	return kind === 'dns' ? 'dns.security_category' : 'http.request.uri.security_category';
}

function domainsField(kind: PolicyKind) {
	return kind === 'dns' ? 'dns.domains' : 'http.request.domains';
}

function escapeField(field: string) {
	return field.replaceAll('.', String.raw`\.`);
}

/** Reads the `{<id> <id>}` set out of an `any(<field>[*] in {...})` clause - empty when the clause isn't present. */
function parseIdSet(traffic: string, field: string) {
	const ids: number[] = [];
	const match = new RegExp(String.raw`any\(${escapeField(field)}\[\*\]\s+in\s+\{([^}]*)\}\)`).exec(traffic);
	if (!match?.[1]) return ids;

	for (const idText of match[1].trim().split(/\s+/)) {
		const id = Number(idText);
		if (Number.isFinite(id)) ids.push(id);
	}

	return ids;
}

/** `undefined` means the selection is empty and must not be sent to Cloudflare as a `traffic` string - callers must treat this as "select at least one category (or list)". */
export function buildTraffic(kind: PolicyKind, selection: PolicySelection): string | undefined {
	const clauses: string[] = [];

	if (selection.categoryIds.length > 0) clauses.push(`any(${contentCategoryField(kind)}[*] in {${selection.categoryIds.join(' ')}})`);
	if (selection.securityCategoryIds.length > 0) clauses.push(`any(${securityCategoryField(kind)}[*] in {${selection.securityCategoryIds.join(' ')}})`);
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
	const securityCategoryIds: number[] = [];
	const listIds: string[] = [];
	const locationIds: string[] = [];

	if (traffic) {
		categoryIds.push(...parseIdSet(traffic, contentCategoryField(kind)));
		securityCategoryIds.push(...parseIdSet(traffic, securityCategoryField(kind)));

		const listMatches = traffic.matchAll(new RegExp(String.raw`any\(${escapeField(domainsField(kind))}\[\*\]\s+in\s+\$([\w-]+)\)`, 'g'));
		for (const match of listMatches) if (match[1]) listIds.push(match[1]);

		if (kind === 'dns') {
			const locationMatch = /dns\.location\s+in\s+\{([^}]*)\}/.exec(traffic);
			if (locationMatch?.[1]) {
				for (const quoted of locationMatch[1].matchAll(/"([^"]*)"/g)) if (quoted[1]) locationIds.push(quoted[1]);
			}
		}
	}

	return { categoryIds, securityCategoryIds, listIds, locationIds };
}
