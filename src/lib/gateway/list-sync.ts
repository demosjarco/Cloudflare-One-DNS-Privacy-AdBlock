import type { RequestEventAction } from '@builder.io/qwik-city';
import { APIError } from 'cloudflare';
import { BlocklistFetchError, fetchPiholeBlocklist, type OverflowStrategy } from '~/lib/blocklist/pihole';
import { chunkNameFrom, createManagedList, deleteManagedList, managedListNameFor, MAX_LISTS_PER_ACCOUNT, replaceManagedListContents, type ManagedList, type ManagedListMeta } from '~/lib/gateway/lists';
import type { PolicyKind } from '~/lib/gateway/policy-expression';
import { findManagedRules, ruleIncludesAnyList, setManagedRuleListMembership } from '~/lib/gateway/rules';
import { ZERO_TRUST_UNINITIALIZED } from '~/lib/gateway/zero-trust';

export type ListSyncErrorCode = 'fetch-http' | 'fetch-network' | 'fetch-empty' | 'fetch-too-large' | 'cloudflare' | typeof ZERO_TRUST_UNINITIALIZED | 'lookup-failed' | 'multiple-matches';

const POLICY_KINDS: readonly PolicyKind[] = ['dns', 'http'];

/** A managed-rule read that couldn't be trusted (API failure, or two rules claiming the managed name) while a sync needed to change what the rule references. Nothing is deleted on a guess. */
export class ListSyncRuleError extends Error {
	constructor(public readonly code: 'lookup-failed' | 'multiple-matches') {
		super(code === 'lookup-failed' ? 'Could not read the managed traffic policies' : 'Multiple managed traffic policies found');
		this.name = 'ListSyncRuleError';
	}
}

async function setGroupMembership(apiToken: string, accountId: string, kind: PolicyKind, listIds: string[], included: boolean, signal: AbortSignal) {
	const result = await setManagedRuleListMembership(apiToken, accountId, kind, listIds, included, signal);
	if (!result.ok) throw new ListSyncRuleError(result.error);
}

/** Runs tasks one after another, each starting only once the previous settled (a failure doesn't block the queue). */
export type SerialQueue = <T>(task: () => Promise<T>) => Promise<T>;

/**
 * Every managed-rule change is a read-modify-write of the same two rules, so two groups syncing concurrently ("Refresh all") could each read the rule, then each write it without the other's chunks. One queue shared by every group in a run serialises just those writes; fetch, parse and the per-chunk list uploads still overlap.
 */
export function createSerialQueue(): SerialQueue {
	let tail: Promise<unknown> = Promise.resolve();
	return (task) => {
		const run = tail.then(task, task);
		tail = run.catch(() => undefined);
		return run;
	};
}

/**
 * Pulls the source with this app's `User-Agent` and applies the overflow strategy at `capacity` entries.
 *
 * The `User-Agent` lets list maintainers see who's pulling and from where - live on Workers it resolves to e.g. `cfodpa/163111b (Linux; x86_64) Workers/2026-09-11 (+https://github.com/...)`. `node:os` and `wrangler.json` are imported lazily: `node:os` only exists under `nodejs_compat` (and isn't in Vite's externals list, so a static import would get pulled into the client manifest scan), and the JSON is only wanted for its `compatibility_date`.
 */
async function fetchBlocklist(event: RequestEventAction, url: string, overflow: OverflowStrategy, capacity: number) {
	const [{ machine, release, type }, { compatibility_date }] = await Promise.all([import('node:os'), import('../../../wrangler.json')]);
	const details = [[type(), release()].filter((part) => part.trim().length > 0).join(' '), machine()].filter((part) => part.trim().length > 0).join('; ');
	const userAgent = [`cfodpa/${event.platform.env.GIT_HASH?.substring(0, 7) ?? 'local'}`, details.length > 0 ? `(${details})` : undefined, `Workers/${compatibility_date}`, '(+https://github.com/demosjarco/Cloudflare-One-DNS-Privacy-AdBlock)'].filter(Boolean).join(' ');

	const signal = (event.platform.request ?? event.request).signal;
	return fetchPiholeBlocklist(url, { userAgent, limit: capacity, overflow, signal });
}

/** How many Cloudflare lists a group may occupy right now: its own slots are reusable, the rest of the account's free slots are up for grabs, and the user's `maxLists` caps both. */
export function effectiveMaxLists(maxLists: number, totalLists: number, ownChunks: number) {
	return Math.min(maxLists, MAX_LISTS_PER_ACCOUNT - totalLists + ownChunks);
}

export interface SyncListGroupParams {
	url: string;
	overflow: OverflowStrategy;
	limit: number;
	maxLists: number;
	/** The group's current chunks in `part` order - empty on create. */
	existing: ManagedList[];
	/** Every list on the account (`ManagedListsLookup.totalLists`), for the free-slot calculation. */
	totalLists: number;
	/** Shared across the groups of one concurrent run so their rule writes don't interleave - see {@link createSerialQueue}. A lone sync doesn't need one. */
	ruleWrites?: SerialQueue;
}

export interface SyncListGroupResult {
	primaryId: string;
	parts: number;
	count: number;
	sourceCount: number;
}

/**
 * Fetch -> parse -> limit at the group's combined capacity -> reconcile the chunks by position: index `i` of the new split updates `existing[i]` when there is one and creates a list otherwise; chunks past the new split's end are deleted. The positions are what make a sync that died halfway harmless - whatever it left (a created chunk the rule never learned about, a stale `parts` in a description) is simply overwritten or adopted by the next one, no orphan bookkeeping needed.
 *
 * Order of operations keeps the managed rules pointing only at lists that exist: surplus chunks leave the rules before they're deleted, new chunks are wired in only after every write landed. Chunk writes run one at a time (the list API allows 600 requests/minute account-wide, and "Refresh all" already runs groups in parallel), so a group spread across many lists is a long request.
 *
 * Whether the group belongs in a rule is read from the rule itself before anything changes: any current chunk referenced means the user turned this source on, so every chunk ends up referenced. A failed rule lookup skips that step rather than guessing; the toggles show the partial state and the next sync (or a toggle flip) completes it.
 */
export async function syncListGroup(event: RequestEventAction, apiToken: string, accountId: string, params: SyncListGroupParams, signal: AbortSignal): Promise<SyncListGroupResult> {
	const { url, overflow, limit, maxLists, existing, totalLists } = params;
	const ruleWrites: SerialQueue = params.ruleWrites ?? ((task) => task());

	const allowedLists = effectiveMaxLists(maxLists, totalLists, existing.length);
	// Create checks the quota before calling, and a refresh always owns at least one slot - reaching here means a caller skipped its own guard.
	if (allowedLists < 1) throw new Error('No list slots available on this account');

	// The one place a whole source is in memory: the fetcher's dedup set becomes this array, each chunk below is a short-lived slice of it, and all of it is garbage once the request returns - nothing is cached anywhere.
	const fetched = await fetchBlocklist(event, url, overflow, limit * allowedLists);
	const parts = Math.ceil(fetched.domains.length / limit);
	const existingIds = existing.map((chunk) => chunk.id);

	// Read before any write so a group whose surplus chunk was the only one still referenced (an earlier interrupted sync) is still recognised as "on".
	const lookups = await findManagedRules(apiToken, accountId, signal);
	const wiredKinds = POLICY_KINDS.filter((kind) => !lookups[kind].failed && !lookups[kind].multipleMatches && ruleIncludesAnyList(lookups[kind], kind, existingIds));

	const surplus = existing.slice(parts);
	if (surplus.length > 0) {
		const surplusIds = surplus.map((chunk) => chunk.id);
		for (const kind of POLICY_KINDS) await ruleWrites(() => setGroupMembership(apiToken, accountId, kind, surplusIds, false, signal));
		for (const chunk of surplus) await deleteManagedList(apiToken, accountId, chunk.id, signal);
	}

	const baseMeta = { v: 2 as const, url, fetchedAt: new Date().toISOString(), overflow, limit, maxLists, sourceCount: fetched.sourceCount, parts };
	const primaryName = existing[0]?.name;
	const chunkIds: string[] = [];
	for (let index = 0; index < parts; index++) {
		const part = index + 1;
		const domains = fetched.domains.slice(index * limit, part * limit);
		const meta: ManagedListMeta = { ...baseMeta, part };
		const current = existing[index];

		if (current) {
			await replaceManagedListContents(apiToken, accountId, current, { meta, domains }, signal);
			chunkIds.push(current.id);
		} else {
			const name = primaryName === undefined ? managedListNameFor(url, fetched.title, part) : chunkNameFrom(primaryName, part);
			const created = await createManagedList(apiToken, accountId, { name, meta, domains }, signal);
			if (!created.id) throw new Error('Cloudflare returned a list without an id');
			chunkIds.push(created.id);
		}
	}

	for (const kind of wiredKinds) await ruleWrites(() => setGroupMembership(apiToken, accountId, kind, chunkIds, true, signal));

	return { primaryId: chunkIds[0]!, parts, count: fetched.domains.length, sourceCount: fetched.sourceCount };
}

/**
 * Cloudflare's docs don't say whether a list referenced by a policy can be deleted, so this never relies on a cascade: every chunk is pulled out of both managed rules first (a rule left with nothing to match is deleted - see `setManagedRuleListMembership`), and only then are the lists themselves removed, primary last so a half-finished delete still resolves to the same route.
 */
export async function deleteListGroup(apiToken: string, accountId: string, chunks: ManagedList[], signal: AbortSignal) {
	const chunkIds = chunks.map((chunk) => chunk.id);
	for (const kind of POLICY_KINDS) await setGroupMembership(apiToken, accountId, kind, chunkIds, false, signal);
	for (const chunk of [...chunks].reverse()) await deleteManagedList(apiToken, accountId, chunk.id, signal);
}

/** Maps the error families an action can hit (blocklist fetch/parse, Cloudflare API, an untrustworthy rule read) to a stable code + the upstream message, for `event.fail`. Anything else is a genuine bug and is rethrown. */
export function classifySyncError(err: unknown): { status: number; error: ListSyncErrorCode; message: string } {
	if (err instanceof BlocklistFetchError) {
		const status = err.code === 'too-large' ? 413 : 422;
		return { status, error: `fetch-${err.code}` as const, message: err.message };
	}
	if (err instanceof ListSyncRuleError) return { status: err.code === 'multiple-matches' ? 409 : 502, error: err.code, message: err.message };
	if (isZeroTrustUninitialized(err)) return { status: 412, error: ZERO_TRUST_UNINITIALIZED, message: err.message };
	if (err instanceof APIError) return { status: typeof err.status === 'number' ? err.status : 502, error: 'cloudflare', message: err.message };
	throw err;
}

/**
 * Cloudflare answers Gateway writes on an account that never went through Zero Trust onboarding with `401` + error `1001` "Account ID is invalid or has not been initialized." - observed live on `rules.create`, while `rules.list` on the same account succeeded with no rules, so the page's reads can't spot it ahead of time. The account id is format-checked in the `[accountId]` layout and comes from the user's own account list, so `1001` here means "not onboarded", not a typo.
 */
export function isZeroTrustUninitialized(err: unknown): err is APIError {
	return err instanceof APIError && err.errors.some((error) => error.code === 1001);
}
