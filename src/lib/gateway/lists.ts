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

const sharedMetaFields = {
	url: zm.url(),
	fetchedAt: zm.iso.datetime(),
	overflow: zm.enum(OVERFLOW_STRATEGIES),
	limit: zm.int().check(zm.refine(isValidEntryLimit)),
	/** Unique hostnames in the source at the last fetch, so the UI can show how much the capacity truncated. */
	sourceCount: zm.int(),
};

/** The pre-chunking format: one source, one list. Still parsed so nothing synced by an older build goes invisible; rewritten as v2 on its next refresh. */
const managedListMetaV1Schema = zm.object({ v: zm.literal(1), ...sharedMetaFields });

/**
 * Everything this app needs to re-sync a list lives in the list's own `description` on Cloudflare's side (zero retention on this server). Tested by hand: the API accepted an 860,000-character description, so the JSON size is a non-issue.
 *
 * One source URL may be spread across several Cloudflare lists ("chunks") when it exceeds the per-list entry limit. Every chunk carries the full metadata, so the group can be rebuilt from any one of them: the chunks of a source find each other by `url` (compared case-insensitively - the same key the duplicate-source check uses), and `part` orders them.
 */
export const managedListMetaSchema = zm.object({
	v: zm.literal(2),
	...sharedMetaFields,
	/** The user's ceiling on how many Cloudflare lists this source may occupy. Re-checked against the account's free list slots on every sync, so the number actually used can be lower. */
	maxLists: zm.int().check(zm.gte(1)),
	/** 1-based position of this chunk within its group as of the last sync that wrote it. */
	part: zm.int().check(zm.gte(1)),
	/** How many chunks the group had as of the last sync that wrote this one - informational (the dashboard reader sees "2 of 5"); the live chunk count is whatever `findManagedLists` finds. */
	parts: zm.int().check(zm.gte(1)),
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

/** One synced source: the Cloudflare lists it's spread across, in `part` order. A list without parseable metadata is a group of one, keyed by its own id, so it still shows up in the table. */
export interface ManagedListGroup {
	/** Lowercased source URL, or the list id for a metadata-less list. */
	key: string;
	/** The lowest-`part` chunk: its id is the group's route, its name is the base every other chunk's name derives from. */
	primary: ManagedList;
	chunks: ManagedList[];
	/** The primary chunk's metadata. Chunks written by the same sync carry identical settings; after a sync that failed partway the primary's is the most recent, since chunks are written in part order. */
	meta: ManagedListMeta | undefined;
	/** Entries across every chunk - `undefined` when Cloudflare didn't report a count for one of them. */
	count: number | undefined;
}

export interface ManagedListsLookup {
	lists: ManagedList[];
	groups: ManagedListGroup[];
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

/** v2 as-is; v1 is a one-chunk group that was never allowed to grow. Anything else (hand-edited, not JSON) is `undefined`. */
export function parseManagedListMeta(description: string | undefined | null): ManagedListMeta | undefined {
	if (!description) return undefined;

	let json: unknown;
	try {
		json = JSON.parse(description);
	} catch {
		return undefined;
	}

	const v2 = zm.safeParse(managedListMetaSchema, json);
	if (v2.success) return v2.data;

	const v1 = zm.safeParse(managedListMetaV1Schema, json);
	if (v1.success) return { ...v1.data, v: 2, maxLists: 1, part: 1, parts: 1 };

	return undefined;
}

/** Cloudflare's dashboard shows list names in a fixed-width column; past this they're unreadable. Not a documented API cap. */
const MAX_LIST_NAME_LENGTH = 64;

/** Part 1 carries the bare name so a single-chunk group looks exactly like it did before chunking existed; later parts get `_p<N>`. The suffix is reserved inside the length cap so every chunk of a group shares the same base. */
function chunkSuffix(part: number) {
	return part === 1 ? '' : `_p${part}`;
}

function withChunkSuffix(baseName: string, part: number) {
	const suffix = chunkSuffix(part);
	return `${baseName.slice(0, MAX_LIST_NAME_LENGTH - suffix.length)}${suffix}`;
}

/** `cfodpa_` + a slug of the list's own `# Title:` header when it has one (`cfodpa_stevenblack_hosts`), else of the source URL's host + path - capped so the name stays readable in the dashboard. Uniqueness isn't required by Cloudflare; duplicate *sources* are rejected separately by the create action. */
export function managedListNameFor(sourceUrl: string, title: string | undefined, part = 1) {
	const parsed = new URL(sourceUrl);
	const trimmedTitle = title?.trim();
	const basis = trimmedTitle !== undefined && trimmedTitle.length > 0 ? trimmedTitle : `${parsed.hostname}${parsed.pathname}`.replace(/\.(txt|list|hosts)$/i, '');
	const slug = basis
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, '_')
		.replace(/^_+|_+$/g, '');

	return withChunkSuffix(`${MANAGED_LIST_PREFIX}${slug}`, part);
}

/** Names a chunk added to an existing group on refresh after the group's primary, so it doesn't matter whether the source's `# Title:` changed since the group was created. The primary normally has no suffix; stripping one anyway covers a group whose part 1 was deleted by hand. */
export function chunkNameFrom(primaryName: string, part: number) {
	return withChunkSuffix(primaryName.replace(/_p\d+$/i, ''), part);
}

function toManagedList(list: GatewayList): ManagedList | undefined {
	if (!list.id || !list.name) return undefined;
	return { id: list.id, name: list.name, count: list.count, updatedAt: list.updated_at, meta: parseManagedListMeta(list.description) };
}

/** Groups by lowercased source URL, chunks sorted by `part` (then name, so two chunks left with the same `part` by an interrupted sync still order deterministically). Group order is first appearance in `lists`. */
export function groupManagedLists(lists: ManagedList[]): ManagedListGroup[] {
	const byKey = new Map<string, ManagedList[]>();
	for (const list of lists) {
		const key = list.meta ? list.meta.url.toLowerCase() : list.id;
		const chunks = byKey.get(key);
		if (chunks) chunks.push(list);
		else byKey.set(key, [list]);
	}

	return Array.from(byKey, ([key, chunks]) => {
		chunks.sort((a, b) => (a.meta?.part ?? 1) - (b.meta?.part ?? 1) || a.name.localeCompare(b.name));
		const primary = chunks[0]!;
		const count = chunks.every((chunk) => chunk.count !== undefined) ? chunks.reduce((sum, chunk) => sum + chunk.count!, 0) : undefined;
		return { key, primary, chunks, meta: primary.meta, count };
	});
}

/** The group synced from a source URL, if any. */
export function findGroupByUrl(lookup: ManagedListsLookup, url: string) {
	const key = url.toLowerCase();
	return lookup.groups.find((group) => group.key === key);
}

/** Resolves any chunk id (not only the primary's) to its group, so a stale link to a chunk that is no longer part 1 still lands on the right page. */
export function findGroupByListId(lookup: ManagedListsLookup, listId: string) {
	const target = listId.toLowerCase();
	return lookup.groups.find((group) => group.chunks.some((chunk) => chunk.id.toLowerCase() === target));
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

		return { lists, groups: groupManagedLists(lists), totalLists: all.length, failed: false };
	} catch (err) {
		if (err instanceof APIError) return { lists: [], groups: [], totalLists: 0, failed: true };
		throw err;
	}
}

/** The items endpoint's page size, and the UI's: one page section on the detail route is exactly one of these requests. The API's hard ceiling - probed live (2026-10-11): `per_page=5000` is silently capped to 1,000 rows, not rejected - so a 5,000-entry list is always five requests. The default page is 50. */
export const LIST_ITEMS_PER_PAGE = 1000;

/**
 * One page of a list's entries, nothing more - the detail route fetches a page only when its section is expanded, so neither the Worker nor the browser ever holds a whole list. How many pages a list has comes from its own `count` (`ceil(count / LIST_ITEMS_PER_PAGE)`), not from paging until a short page: a list of exactly 5,000 would otherwise cost a sixth, empty request to find out it was done.
 * The SDK types this endpoint as a `SinglePage` and ignores `page`, so the query is passed explicitly.
 * @link https://developers.cloudflare.com/api/resources/zero_trust/subresources/gateway/subresources/lists/subresources/items/methods/list/
 */
export async function listManagedListItemsPage(apiToken: string, accountId: string, listId: string, page: number, signal: AbortSignal): Promise<{ items: GatewayItem[]; failed: boolean }> {
	try {
		const { result } = await gatewayClient(apiToken).zeroTrust.gateway.lists.items.list(listId, { account_id: accountId }, { query: { page, per_page: LIST_ITEMS_PER_PAGE }, signal });
		return { items: result, failed: false };
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
