import { APIError } from 'cloudflare';
import { BaseItems } from 'cloudflare/resources/zero-trust/gateway/lists/items';
import { BaseLists, type GatewayItem, type GatewayList } from 'cloudflare/resources/zero-trust/gateway/lists/lists';
import { createClient } from 'cloudflare/tree-shakable';
import * as zm from 'zod/mini';
import { OVERFLOW_STRATEGIES } from '~/lib/blocklist/pihole';

export type { GatewayItem };

/** Same convention as `MANAGED_RULE_NAMES` in `rules.ts` - the prefix is what tells this app's synced lists apart from any lists the user already has. Matched case-insensitively. */
export const MANAGED_LIST_PREFIX = 'cfodpa_';

/**
 * Account-wide limits, shared with any lists the user created outside this app.
 *
 * The entry limit is a per-list *user choice*, not detected: probed live (2026-10-08) with this OAuth client's scopes, nothing reachable says which Zero Trust plan an account is on - `GET /memberships` omits `account.type` (despite the SDK typing it), `GET /accounts/{id}` is 403, `/subscriptions` needs Billing Read (not among the OAuth app's scopes), and neither the Gateway account-info nor configuration objects carry a plan. Enterprise's 5,000 is also only a default that account teams can raise, so the field is a free positive integer with the two documented tiers as suggestions; a value above the real cap is caught by Cloudflare's own rejection, which is surfaced verbatim.
 * @link https://developers.cloudflare.com/cloudflare-one/account-limits/#gateway
 */
export const MAX_LISTS_PER_ACCOUNT = 100;
export const SUGGESTED_ENTRY_LIMITS = { standard: 1000, enterprise: 5000 } as const;

/** Exactly the Standard tier, exactly the Enterprise default, or a raised Enterprise cap above it - nothing in between makes sense as a plan limit. */
export function isValidEntryLimit(limit: number) {
	return Number.isInteger(limit) && (limit === SUGGESTED_ENTRY_LIMITS.standard || limit >= SUGGESTED_ENTRY_LIMITS.enterprise);
}

/**
 * Everything this app needs to re-sync a list lives in the list's own `description` on Cloudflare's side (zero retention on this server). Tested by hand: the API accepted an 860,000-character description, so the JSON size is a non-issue.
 */
export const managedListMetaSchema = zm.object({
	v: zm.literal(1),
	url: zm.url(),
	fetchedAt: zm.iso.datetime(),
	overflow: zm.enum(OVERFLOW_STRATEGIES),
	limit: zm.int().check(zm.refine(isValidEntryLimit)),
	/** Unique hostnames in the source at the last fetch, so the UI can show how much the entry limit truncated. */
	sourceCount: zm.int(),
});
export type ManagedListMeta = zm.infer<typeof managedListMetaSchema>;

export interface ManagedList {
	id: string;
	name: string;
	count: number | undefined;
	updatedAt: string | undefined;
	/** `undefined` when the description isn't this app's JSON (hand-edited in the dashboard, or written by an older version) - the row still renders so the list isn't invisible while counting toward the account quota, but it can't be refreshed. */
	meta: ManagedListMeta | undefined;
}

export interface ManagedListsLookup {
	lists: ManagedList[];
	/** Every list on the account regardless of type/name - what the 100-list quota is measured against. */
	totalLists: number;
	failed: boolean;
}

function gatewayClient(apiToken: string) {
	return createClient({ apiToken, resources: [BaseLists, BaseItems] });
}

export function isManagedListName(name: string | undefined) {
	return name?.trim().toLowerCase().startsWith(MANAGED_LIST_PREFIX) ?? false;
}

function serializeManagedListMeta(meta: ManagedListMeta) {
	return JSON.stringify(meta);
}

/** `cfodpa_` + a slug of the list's own `# Title:` header when it has one (`cfodpa_stevenblack_hosts`), else of the source URL's host + path - capped so the name stays readable in the dashboard. Uniqueness isn't required by Cloudflare; duplicate *sources* are rejected separately by the create action. */
export function managedListNameFor(sourceUrl: string, title: string | undefined) {
	const parsed = new URL(sourceUrl);
	const trimmedTitle = title?.trim();
	const basis = trimmedTitle !== undefined && trimmedTitle.length > 0 ? trimmedTitle : `${parsed.hostname}${parsed.pathname}`.replace(/\.(txt|list|hosts)$/i, '');
	const slug = basis
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, '_')
		.replace(/^_+|_+$/g, '');

	return `${MANAGED_LIST_PREFIX}${slug}`.slice(0, 64);
}

function toManagedList(list: GatewayList): ManagedList | undefined {
	if (!list.id || !list.name) return undefined;

	let meta: ManagedListMeta | undefined;
	try {
		const result = list.description ? zm.safeParse(managedListMetaSchema, JSON.parse(list.description)) : undefined;
		meta = result?.success ? result.data : undefined;
	} catch {
		meta = undefined;
	}

	return { id: list.id, name: list.name, count: list.count, updatedAt: list.updated_at, meta };
}

/**
 * @link https://developers.cloudflare.com/api/resources/zero_trust/subresources/gateway/subresources/lists/methods/list/
 */
export async function findManagedLists(apiToken: string, accountId: string, signal: AbortSignal): Promise<ManagedListsLookup> {
	try {
		const all = await Array.fromAsync(gatewayClient(apiToken).zeroTrust.gateway.lists.list({ account_id: accountId }, { signal }));
		const lists = all
			.filter((list) => list.type === 'DOMAIN' && isManagedListName(list.name))
			.map(toManagedList)
			.filter((list) => list !== undefined);

		return { lists, totalLists: all.length, failed: false };
	} catch (err) {
		if (err instanceof APIError) return { lists: [], totalLists: 0, failed: true };
		throw err;
	}
}

/**
 * Returns `null` for a list that exists but isn't one of this app's (wrong type or no prefix) - the detail route treats that the same as not-found rather than exposing a user's own list under this app's URL.
 * @link https://developers.cloudflare.com/api/resources/zero_trust/subresources/gateway/subresources/lists/methods/get/
 */
export async function getManagedList(apiToken: string, accountId: string, listId: string, signal: AbortSignal): Promise<{ list: ManagedList | null; failed: boolean }> {
	try {
		const list = await gatewayClient(apiToken).zeroTrust.gateway.lists.get(listId, { account_id: accountId }, { signal });
		if (list.type !== 'DOMAIN' || !isManagedListName(list.name)) return { list: null, failed: false };
		return { list: toManagedList(list) ?? null, failed: false };
	} catch (err) {
		if (err instanceof APIError) return { list: null, failed: err.status !== 404 };
		throw err;
	}
}

/**
 * The items endpoint is page-based (`page`/`per_page`, max 1,000 per page - observed live: the default page is 50) but the SDK types it as a `SinglePage`, so `Array.fromAsync` silently stops after the first page. Pages are walked by hand; with the 5,000-entry Enterprise cap that's at most five requests.
 * @link https://developers.cloudflare.com/api/resources/zero_trust/subresources/gateway/subresources/lists/subresources/items/methods/list/
 */
export async function listManagedListItems(apiToken: string, accountId: string, listId: string, signal: AbortSignal): Promise<{ items: GatewayItem[]; failed: boolean }> {
	const PER_PAGE = 1000;
	const MAX_PAGES = 10;
	const items: GatewayItem[] = [];

	try {
		const client = gatewayClient(apiToken);
		for (let page = 1; page <= MAX_PAGES; page++) {
			const { result } = await client.zeroTrust.gateway.lists.items.list(listId, { account_id: accountId }, { query: { page, per_page: PER_PAGE }, signal });
			items.push(...result);
			if (result.length < PER_PAGE) break;
		}
		return { items, failed: false };
	} catch (err) {
		if (err instanceof APIError) return { items: [], failed: true };
		throw err;
	}
}

/**
 * @link https://developers.cloudflare.com/api/resources/zero_trust/subresources/gateway/subresources/lists/methods/create/
 */
export async function createManagedList(apiToken: string, accountId: string, params: { name: string; meta: ManagedListMeta; domains: string[] }, signal: AbortSignal) {
	return gatewayClient(apiToken).zeroTrust.gateway.lists.create(
		{
			account_id: accountId,
			name: params.name,
			type: 'DOMAIN',
			description: serializeManagedListMeta(params.meta),
			items: params.domains.map((value) => ({ value })),
		},
		{ signal },
	);
}

/**
 * Full replacement: per the API, a non-empty `items` overwrites the existing list wholesale (so a hostname that dropped out of the source drops out here too), `name` is required on every update, and the description is re-sent with the fresh `fetchedAt`. Callers must never pass an empty `domains` - what the API does with `items: []` is undocumented, and the blocklist fetcher already refuses to return an empty result.
 * @link https://developers.cloudflare.com/api/resources/zero_trust/subresources/gateway/subresources/lists/methods/update/
 */
export async function replaceManagedListContents(apiToken: string, accountId: string, list: ManagedList, params: { meta: ManagedListMeta; domains: string[] }, signal: AbortSignal) {
	if (params.domains.length === 0) throw new Error('Refusing to replace a list with zero entries');

	return gatewayClient(apiToken).zeroTrust.gateway.lists.update(
		list.id,
		{
			account_id: accountId,
			name: list.name,
			description: serializeManagedListMeta(params.meta),
			items: params.domains.map((value) => ({ value })),
		},
		{ signal },
	);
}

/**
 * @link https://developers.cloudflare.com/api/resources/zero_trust/subresources/gateway/subresources/lists/methods/delete/
 */
export async function deleteManagedList(apiToken: string, accountId: string, listId: string, signal: AbortSignal) {
	await gatewayClient(apiToken).zeroTrust.gateway.lists.delete(listId, { account_id: accountId }, { signal });
}
