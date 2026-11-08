import { $, component$, useComputed$, useStore } from '@builder.io/qwik';
import { Link, routeAction$, routeLoader$, useLocation, useNavigate, zod$, type DocumentHead } from '@builder.io/qwik-city';
import { LuExternalLink, LuRefreshCw } from '@qwikest/icons/lucide';
import { TrafficPolicyCard } from '~/components/gateway/traffic-policy-card';
import { type PolicyState } from '~/components/gateway/tri-state-control';
import { AutoRefreshToggle, describeAutoRefreshSupport, useAutoRefresh } from '~/components/lists/auto-refresh';
import { CreateListDialog } from '~/components/lists/create-list-dialog';
import { ZeroTrustSetupNotice } from '~/components/gateway/zero-trust-setup-notice';
import { PolicyListToggle } from '~/components/lists/policy-list-toggle';
import { actionFailure, BUTTON_SECONDARY } from '~/components/lists/shared';
import { getCloudflareAccessToken } from '~/lib/auth/cloudflare-token';
import { OVERFLOW_STRATEGIES } from '~/lib/blocklist/pihole';
import { formatDateTime } from '~/lib/format-date';
import { resolveManagedCategories } from '~/lib/gateway/categories';
import { classifySyncError, syncListGroup } from '~/lib/gateway/list-sync';
import { findGroupByUrl, findManagedLists, isValidEntryLimit, MAX_LISTS_PER_ACCOUNT, type ManagedListGroup } from '~/lib/gateway/lists';
import { listDnsLocations } from '~/lib/gateway/locations';
import { buildTraffic, parseTraffic, type PolicyKind } from '~/lib/gateway/policy-expression';
import { ZERO_TRUST_UNINITIALIZED } from '~/lib/gateway/zero-trust';
import { listRefreshPath, type PeriodicRefreshTarget } from '~/lib/periodic-refresh';
import { createManagedRule, deleteManagedRule, findManagedRule, ruleIncludesAllLists, ruleIncludesAnyList, updateManagedRuleFull, type ManagedRuleLookup } from '~/lib/gateway/rules';
import { useAuthToken, useLocale, useTimezone } from '~/routes/layout';
import { useManagedRules, useToggleListPolicy } from './layout';

// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore this gets generated automatically later in the build process
import * as m from '~/paraglide/messages';

// Function form on purpose - see `routes/index.tsx`.
export const head: DocumentHead = () => ({
	title: m.page_title_policies(),
	meta: [
		{
			name: 'description',
			content: m.page_description_policies(),
		},
	],
});

// eslint-disable-next-line qwik/loader-location
const useManagedCategories = routeLoader$(async ({ resolveValue, params, platform, request }) => {
	const token = await resolveValue(useAuthToken);
	if (!token?.cloudflare?.accessToken) return { categories: [], failed: true };

	return resolveManagedCategories(token.cloudflare.accessToken, params['accountId']!, (platform.request ?? request).signal);
});

// eslint-disable-next-line qwik/loader-location
const useDnsLocations = routeLoader$(async ({ resolveValue, params, platform, request }) => {
	const token = await resolveValue(useAuthToken);
	if (!token?.cloudflare?.accessToken) return { locations: [], failed: true };

	return listDnsLocations(token.cloudflare.accessToken, params['accountId']!, (platform.request ?? request).signal);
});

// eslint-disable-next-line qwik/loader-location
const useManagedLists = routeLoader$(async ({ resolveValue, params, platform, request }) => {
	const token = await resolveValue(useAuthToken);
	if (!token?.cloudflare?.accessToken) return { lists: [], groups: [], totalLists: 0, failed: true };

	return findManagedLists(token.cloudflare.accessToken, params['accountId']!, (platform.request ?? request).signal);
});

/**
 * One action shared by both cards (each card calls this hook itself, giving each its own independent
 * `isRunning`/fade state - see `traffic-policy-card.tsx`). Handles every tri-state transition described in
 * the plan: create on `deleted -> enabled/disabled`, a full-PUT update (categories/locations and/or
 * `enabled`, `precedence` always carried through unchanged) on `enabled <-> disabled` or a selection-only
 * change, and delete on `-> deleted`.
 *
 * `zod$` here must use its callback form: `qwik-city` bundles its own internal zod (v3) for form
 * validation, distinct from this app's top-level zod (v4, used elsewhere as `zod/mini`) - passing a
 * schema built from the app's own zod doesn't type-check against `zod$`'s expected schema type. The
 * callback's `z` parameter *is* qwik-city's bundled zod.
 */
export const useUpdatePolicy = routeAction$(
	async (data, event) => {
		const apiToken = await getCloudflareAccessToken(event.request, event.platform, event.url, event.sharedMap);
		if (!apiToken) return event.fail(401, { error: 'no-token' });
		const accountId = event.params['accountId']!;
		const signal = (event.platform.request ?? event.request).signal;

		const lookup = await findManagedRule(apiToken, accountId, data.kind, signal);
		if (lookup.failed) return event.fail(502, { error: 'lookup-failed' });
		if (lookup.multipleMatches) return event.fail(409, { error: 'multiple-matches' });

		const desired = data.state ?? data.currentState;

		if (desired === 'deleted') {
			if (lookup.rule?.id) {
				try {
					await deleteManagedRule(apiToken, accountId, lookup.rule.id, signal);
				} catch (err) {
					const classified = classifySyncError(err);
					return event.fail(classified.status, { error: classified.error, message: classified.message });
				}
			}
			return { ok: true as const };
		}

		let { categoryIds, securityCategoryIds } = data;
		// A deleted policy renders every toggle off, so an Enabled/Disabled click straight from that state arrives with nothing selected - create it with every managed category instead, keeping that first click a one-step, non-empty rule. A category toggled on while deleted (no `state` submitter) creates with just that selection.
		if (!lookup.rule && data.state && categoryIds.length === 0 && securityCategoryIds.length === 0) {
			const managed = await resolveManagedCategories(apiToken, accountId, signal);
			if (managed.failed) return event.fail(502, { error: 'lookup-failed' });
			categoryIds = managed.categories.filter((category) => category.group === 'privacy').map((category) => category.id);
			securityCategoryIds = managed.categories.filter((category) => category.group === 'security').map((category) => category.id);
		}

		const traffic = buildTraffic(data.kind, {
			categoryIds,
			securityCategoryIds,
			// Synced lists are toggled from the lists table (`useToggleListPolicy` in `./layout.tsx`), never from this form - whatever the rule already references is carried through untouched, otherwise every category/location change here would silently drop them.
			listIds: lookup.rule ? parseTraffic(data.kind, lookup.rule.traffic).listIds : [],
			locationIds: data.kind === 'dns' && data.locationScope === 'selected' ? data.locationIds : [],
		});
		// Never send Cloudflare an empty `traffic` string - mirrors the client-side guard in `category-toggles.tsx`.
		if (!traffic) return event.fail(400, { error: 'empty-selection' });

		const enabled = desired === 'enabled';
		try {
			if (lookup.rule) await updateManagedRuleFull(apiToken, accountId, lookup.rule, { enabled, traffic }, signal);
			else await createManagedRule(apiToken, accountId, data.kind, { enabled, traffic }, signal);
		} catch (err) {
			// Same Cloudflare-error mapping as the list actions - most visibly a never-onboarded Zero Trust account, which only fails here, on the first write.
			const classified = classifySyncError(err);
			return event.fail(classified.status, { error: classified.error, message: classified.message });
		}

		return { ok: true as const };
	},
	zod$((z) =>
		z.object({
			kind: z.enum(['dns', 'http']),
			/** Present only when a tri-state segment button was the form's submitter - see `traffic-policy-card.tsx`. */
			state: z.enum(['enabled', 'disabled', 'deleted']).optional(),
			/** The card's last-known persisted state, resent as a hidden field so a category/location-only change (no tri-state button clicked) still knows what to keep the rule at. */
			currentState: z.enum(['enabled', 'disabled']),
			categoryIds: z.array(z.coerce.number().int()).optional().default([]),
			/** Posted under its own field name by `category-toggles.tsx` - security categories need Gateway's separate `security_category` selector. */
			securityCategoryIds: z.array(z.coerce.number().int()).optional().default([]),
			locationScope: z.enum(['all', 'selected']).optional().default('all'),
			locationIds: z.array(z.string()).optional().default([]),
		}),
	),
);

/**
 * Fetch -> parse -> limit -> create (one Cloudflare list per `limit` entries, up to `maxLists` of them). Quota and duplicate-source checks happen against a fresh `lists.list()` read rather than the loader's snapshot, so two tabs can't both squeeze past the 100-list cap. `maxLists` above the account's free slots isn't an error: the sync uses what's free and the stored choice applies again when slots open up.
 *
 * Returns the new group's primary id instead of redirecting into it: the dialog (`create-list-dialog.tsx`) first registers the source for background refresh in this browser - a browser-side API - and only then navigates.
 */
export const useCreateList = routeAction$(
	async (data, event) => {
		const apiToken = await getCloudflareAccessToken(event.request, event.platform, event.url, event.sharedMap);
		if (!apiToken) return event.fail(401, { error: 'no-token' });
		const accountId = event.params['accountId']!;
		const signal = (event.platform.request ?? event.request).signal;

		const existing = await findManagedLists(apiToken, accountId, signal);
		if (existing.failed) return event.fail(502, { error: 'lookup-failed' });
		if (existing.totalLists >= MAX_LISTS_PER_ACCOUNT) return event.fail(409, { error: 'quota' });

		const sourceUrl = data.url.trim();
		if (findGroupByUrl(existing, sourceUrl)) return event.fail(409, { error: 'duplicate' });

		try {
			const { primaryId } = await syncListGroup(event, apiToken, accountId, { url: sourceUrl, overflow: data.overflow, limit: data.limit, maxLists: data.maxLists, existing: [], totalLists: existing.totalLists }, signal);
			return { ok: true as const, primaryId };
		} catch (err) {
			const classified = classifySyncError(err);
			return event.fail(classified.status, { error: classified.error, message: classified.message });
		}
	},
	zod$((z) =>
		z.object({
			url: z
				.string()
				.trim()
				.url()
				.refine((value) => /^https?:\/\//i.test(value), { message: 'Only http(s) URLs are supported' }),
			overflow: z.enum(OVERFLOW_STRATEGIES),
			limit: z.coerce.number().refine(isValidEntryLimit),
			maxLists: z.coerce.number().int().min(1).max(MAX_LISTS_PER_ACCOUNT),
		}),
	),
);

type RowRefresh = { state: 'running' } | { state: 'ok' } | { state: 'failed'; message: string };

/**
 * "Refresh all" is one `POST` per source to the same per-source endpoint the service worker uses (`lists/[listId]/refresh/index.ts`), all in flight at once from the browser, rather than one action that re-syncs every source inside a single Worker request. Each source then gets its own 30s CPU budget (the parse of a big source is real CPU, and N of them in one request shared one budget), rows finish and report independently, and one dead source host never holds up the others' outcome. The per-request rule-write queue a single action could share is the trade-off - see `createSerialQueue` in `lib/gateway/list-sync.ts`.
 *
 * Every source sizes itself against the same list count, so two sources that both grow in the same run can both claim the last free slot - the loser gets Cloudflare's quota rejection on its row, and its next refresh sorts it out.
 */
async function refreshListFromBrowser(target: PeriodicRefreshTarget): Promise<RowRefresh> {
	try {
		const response = await fetch(listRefreshPath(target), { method: 'POST', headers: { accept: 'application/json' } });
		if (response.ok) return { state: 'ok' };

		const body = (await response.json().catch(() => undefined)) as { message?: string } | undefined;
		return { state: 'failed', message: body?.message ?? `HTTP ${response.status}` };
	} catch (err) {
		return { state: 'failed', message: err instanceof Error ? err.message : String(err) };
	}
}

function policyState(lookup: ManagedRuleLookup): PolicyState {
	if (!lookup.rule) return 'deleted';
	return lookup.rule.enabled ? 'enabled' : 'disabled';
}

/** Sources (not Cloudflare lists) the rule references - a chunked source is one entry in the card's "also blocks N synced lists" line, however many lists it spans. */
function groupsInRule(groups: ManagedListGroup[], lookup: ManagedRuleLookup, kind: PolicyKind) {
	return groups.filter((group) =>
		ruleIncludesAnyList(
			lookup,
			kind,
			group.chunks.map((chunk) => chunk.id),
		),
	).length;
}

const TH = 'text-kumo-subtle px-3 py-2 text-left text-xs font-medium tracking-wide uppercase';
const TD = 'px-3 py-2.5 align-middle text-sm';

export default component$(() => {
	const location = useLocation();
	const nav = useNavigate();
	const accountId = location.params['accountId']!;

	const categories = useManagedCategories();
	const dnsLocations = useDnsLocations();
	const rules = useManagedRules();
	const lists = useManagedLists();
	const locale = useLocale();
	const timezone = useTimezone();

	const dnsAction = useUpdatePolicy();
	const httpAction = useUpdatePolicy();
	const createAction = useCreateList();
	const toggleAction = useToggleListPolicy();

	const dnsLookup = rules.value.dns;
	const httpLookup = rules.value.http;
	const groups = lists.value.groups;

	// A deleted (or never-created) policy blocks nothing, so every toggle renders off - `useUpdatePolicy` fills in every managed category when Enabled/Disabled is clicked from here with nothing selected.
	const defaultSelection = {
		categoryIds: [] as number[],
		securityCategoryIds: [] as number[],
		listIds: [],
		locationIds: [] as string[],
	};
	const dnsSelection = dnsLookup.rule ? parseTraffic('dns', dnsLookup.rule.traffic) : defaultSelection;
	const httpSelection = httpLookup.rule ? parseTraffic('http', httpLookup.rule.traffic) : defaultSelection;

	const toggleFailure = actionFailure(toggleAction.value);
	const freeSlots = lists.value.failed ? 0 : Math.max(0, MAX_LISTS_PER_ACCOUNT - lists.value.totalLists);

	// Sources with sync settings, by primary id - what "Refresh all" posts for and what the Auto refresh registrations are pruned against. `undefined` when the loader failed: an empty list would read as "every source is gone" and unregister them all over one bad Cloudflare read.
	const refreshableIds = useComputed$(() => (lists.value.failed ? undefined : lists.value.groups.filter((group) => group.meta !== undefined).map((group) => group.primary.id)));
	const autoRefresh = useAutoRefresh(accountId, refreshableIds);

	const refreshAll = useStore<{ running: boolean; rows: Record<string, RowRefresh>; summary: { succeeded: number; total: number } | undefined }>({ running: false, rows: {}, summary: undefined });
	const refreshAll$ = $(async () => {
		const targets = refreshableIds.value ?? [];
		refreshAll.running = true;
		refreshAll.summary = undefined;
		refreshAll.rows = Object.fromEntries(targets.map((listId) => [listId, { state: 'running' as const }]));

		await Promise.all(
			targets.map(async (listId) => {
				refreshAll.rows[listId] = await refreshListFromBrowser({ accountId, listId });
			}),
		);

		refreshAll.summary = { succeeded: Object.values(refreshAll.rows).filter((row) => row.state === 'ok').length, total: targets.length };
		refreshAll.running = false;
		// Re-runs the loaders so the counts and "Last updated" column reflect the syncs; the per-row outcomes above stay until the next click.
		await nav(location.url.href, { forceReload: true });
	});

	return (
		<div class="flex flex-col gap-6">
			{/* Content-driven wrap instead of a viewport breakpoint: each card keeps shrinking (down to a comfortable minimum) and only drops to its own row once two no longer fit side by side. */}
			<div class="grid grid-cols-[repeat(auto-fit,minmax(min(22rem,100%),1fr))] gap-4">
				<TrafficPolicyCard kind="dns" accountId={accountId} title={m.gateway_dns_card_title()} state={policyState(dnsLookup)} multipleMatches={dnsLookup.multipleMatches} categories={categories.value.categories} categoriesFailed={categories.value.failed} initialCategoryIds={[...dnsSelection.categoryIds, ...dnsSelection.securityCategoryIds]} listCount={groupsInRule(groups, dnsLookup, 'dns')} locations={dnsLocations.value.locations} locationsFailed={dnsLocations.value.failed} initialLocationScope={dnsSelection.locationIds.length > 0 ? 'selected' : 'all'} initialLocationIds={dnsSelection.locationIds} action={dnsAction} />

				<TrafficPolicyCard kind="http" accountId={accountId} title={m.gateway_http_card_title()} state={policyState(httpLookup)} multipleMatches={httpLookup.multipleMatches} categories={categories.value.categories} categoriesFailed={categories.value.failed} initialCategoryIds={[...httpSelection.categoryIds, ...httpSelection.securityCategoryIds]} listCount={groupsInRule(groups, httpLookup, 'http')} action={httpAction} />
			</div>

			<section id="lists" class="flex flex-col gap-3">
				<header class="flex flex-wrap items-start justify-between gap-3">
					<div>
						<h2 class="text-kumo-strong text-lg font-semibold">{m.lists_title()}</h2>
						<p class="text-kumo-subtle mt-1 text-sm">{lists.value.failed ? m.lists_load_error() : m.lists_quota({ used: lists.value.totalLists.toLocaleString(), max: MAX_LISTS_PER_ACCOUNT.toLocaleString() })}</p>
						{autoRefresh.support.value ? <p class="text-kumo-subtle mt-1 text-xs">{describeAutoRefreshSupport(autoRefresh.support.value)}</p> : null}
					</div>
					<div class="flex flex-wrap items-center gap-2">
						<button type="button" class={BUTTON_SECONDARY} disabled={refreshAll.running || !refreshableIds.value?.length} onClick$={refreshAll$}>
							<LuRefreshCw class={['size-4', refreshAll.running && 'animate-spin']} />
							{refreshAll.running ? m.lists_refresh_all_running() : m.lists_refresh_all()}
						</button>
						<CreateListDialog freeSlots={freeSlots} action={createAction} />
					</div>
				</header>

				{/* Per-row outcomes (and the error text of a failed row) live in the table's name column; this is only the tally. */}
				{refreshAll.summary ? <p class={refreshAll.summary.succeeded < refreshAll.summary.total ? 'text-kumo-danger text-sm' : 'text-kumo-subtle text-sm'}>{m.lists_refresh_all_summary({ succeeded: refreshAll.summary.succeeded.toLocaleString(), total: refreshAll.summary.total.toLocaleString() })}</p> : null}

				{toggleFailure?.error === ZERO_TRUST_UNINITIALIZED ? <ZeroTrustSetupNotice /> : toggleFailure ? <p class="text-kumo-danger text-sm">{toggleFailure.error === 'multiple-matches' ? m.lists_error_policy_multiple() : m.lists_error_policy({ message: toggleFailure.message ?? '' })}</p> : null}

				<div class="bg-kumo-base ring-kumo-line overflow-x-auto rounded-lg shadow-xs ring">
					<table class="w-full min-w-[48rem] border-collapse">
						<thead class="border-kumo-line border-b">
							<tr>
								<th class={TH}>{m.lists_col_name()}</th>
								<th class={TH}>{m.lists_col_entries()}</th>
								<th class={TH}>{m.lists_col_lists()}</th>
								<th class={TH}>{m.lists_col_updated()}</th>
								<th class={TH}>DNS</th>
								<th class={TH}>HTTP</th>
								<th class={TH}>{m.lists_col_auto_refresh()}</th>
								<th class={TH}>{m.lists_col_source()}</th>
							</tr>
						</thead>
						<tbody class="divide-kumo-line divide-y">
							{groups.length === 0 ? (
								<tr>
									<td colSpan={8} class="text-kumo-subtle px-3 py-8 text-center text-sm">
										{lists.value.failed ? m.lists_load_error() : m.lists_empty()}
									</td>
								</tr>
							) : (
								groups.map((group) => {
									const href = `/${accountId}/lists/${group.primary.id}/`;
									const chunkIds = group.chunks.map((chunk) => chunk.id);
									const meta = group.meta;
									// Entries were dropped and the group had room for more lists than it got - every account slot was taken, by other sources or by lists outside this app.
									const slotLimited = meta !== undefined && group.count !== undefined && meta.sourceCount > group.count && group.chunks.length < meta.maxLists;
									const rowRefresh = refreshAll.rows[group.primary.id];

									return (
										<tr key={group.key} class="hover:bg-kumo-tint cursor-pointer" onClick$={() => nav(href)}>
											<td class={TD}>
												<Link prefetch="js" href={href} class="text-kumo-strong font-medium" onClick$={(event) => event.stopPropagation()}>
													{group.primary.name}
												</Link>
												{meta ? null : <span class="text-kumo-subtle block text-xs">{m.lists_meta_missing()}</span>}
												{rowRefresh?.state === 'running' ? <span class="text-kumo-subtle block text-xs">{m.lists_refreshing()}</span> : rowRefresh?.state === 'failed' ? <span class="text-kumo-danger block text-xs">{rowRefresh.message}</span> : null}
											</td>
											<td class={[TD, 'text-kumo-default whitespace-nowrap tabular-nums']}>
												{group.count?.toLocaleString() ?? '–'}
												{meta ? <span class="text-kumo-subtle"> / {(meta.limit * meta.maxLists).toLocaleString()}</span> : null}
												{meta && group.count !== undefined && meta.sourceCount > group.count ? <span class="text-kumo-subtle block text-xs">{m.lists_truncated({ source: meta.sourceCount.toLocaleString() })}</span> : null}
											</td>
											<td class={[TD, 'text-kumo-default whitespace-nowrap tabular-nums']}>
												{meta ? m.lists_chunks({ used: group.chunks.length.toLocaleString(), max: meta.maxLists.toLocaleString() }) : group.chunks.length.toLocaleString()}
												{slotLimited ? <span class="text-kumo-danger block text-xs whitespace-normal">{m.lists_slot_limited()}</span> : null}
											</td>
											<td class={[TD, 'text-kumo-default whitespace-nowrap']}>{formatDateTime(meta?.fetchedAt ?? group.primary.updatedAt, locale.value, timezone.value.long) ?? '–'}</td>
											<td class={TD}>
												<PolicyListToggle listIds={chunkIds} kind="dns" included={ruleIncludesAllLists(dnsLookup, 'dns', chunkIds)} label={m.lists_toggle_dns()} action={toggleAction} />
											</td>
											<td class={TD}>
												<PolicyListToggle listIds={chunkIds} kind="http" included={ruleIncludesAllLists(httpLookup, 'http', chunkIds)} label={m.lists_toggle_http()} action={toggleAction} />
											</td>
											<td class={TD}>{meta ? <AutoRefreshToggle listId={group.primary.id} checked={autoRefresh.registered.value.includes(group.primary.id.toLowerCase())} support={autoRefresh.support.value} label={m.lists_toggle_auto_refresh()} onChange$={autoRefresh.setAutoRefresh$} /> : <span class="text-kumo-subtle">–</span>}</td>
											<td class={[TD, 'max-w-xs']}>
												{meta ? (
													<a href={meta.url} target="_blank" rel="noreferrer" class="text-kumo-link inline-flex max-w-full items-center gap-1 underline" onClick$={(event) => event.stopPropagation()}>
														<span class="truncate">{meta.url}</span>
														<LuExternalLink class="size-3.5 shrink-0" />
													</a>
												) : (
													<span class="text-kumo-subtle">–</span>
												)}
											</td>
										</tr>
									);
								})
							)}
						</tbody>
					</table>
				</div>
			</section>
		</div>
	);
});
