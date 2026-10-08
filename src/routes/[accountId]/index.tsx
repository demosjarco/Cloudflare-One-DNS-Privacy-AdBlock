import { component$ } from '@builder.io/qwik';
import { Form, Link, routeAction$, routeLoader$, useLocation, useNavigate, zod$, type DocumentHead } from '@builder.io/qwik-city';
import { LuExternalLink, LuRefreshCw } from '@qwikest/icons/lucide';
import { TrafficPolicyCard } from '~/components/gateway/traffic-policy-card';
import { type PolicyState } from '~/components/gateway/tri-state-control';
import { CreateListDialog } from '~/components/lists/create-list-dialog';
import { PolicyListToggle } from '~/components/lists/policy-list-toggle';
import { actionFailure, BUTTON_SECONDARY } from '~/components/lists/shared';
import { getActionCloudflareAccessToken } from '~/lib/auth/cloudflare-token';
import { OVERFLOW_STRATEGIES } from '~/lib/blocklist/pihole';
import { formatDateTime } from '~/lib/format-date';
import { resolveManagedCategories } from '~/lib/gateway/categories';
import { classifySyncError, syncBlocklist } from '~/lib/gateway/list-sync';
import { createManagedList, findManagedLists, isValidEntryLimit, managedListNameFor, MAX_LISTS_PER_ACCOUNT, replaceManagedListContents } from '~/lib/gateway/lists';
import { listDnsLocations } from '~/lib/gateway/locations';
import { buildTraffic, parseTraffic } from '~/lib/gateway/policy-expression';
import { createManagedRule, deleteManagedRule, findManagedRule, ruleIncludesList, updateManagedRuleFull, type ManagedRuleLookup } from '~/lib/gateway/rules';
import { useAuthToken, useLocale, useTimezone } from '~/routes/layout';
import { useManagedRules, useToggleListPolicy } from './layout';

// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore this gets generated automatically later in the build process
import * as m from '~/paraglide/messages';

export const head: DocumentHead = {
	title: 'Traffic Policies',
	meta: [
		{
			name: 'description',
			content: 'Manage this account’s DNS and HTTP traffic policies and synced blocklists.',
		},
	],
};

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
	if (!token?.cloudflare?.accessToken) return { lists: [], totalLists: 0, failed: true };

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
		const apiToken = await getActionCloudflareAccessToken(event);
		if (!apiToken) return event.fail(401, { error: 'no-token' });
		const accountId = event.params['accountId']!;
		const signal = (event.platform.request ?? event.request).signal;

		const lookup = await findManagedRule(apiToken, accountId, data.kind, signal);
		if (lookup.failed) return event.fail(502, { error: 'lookup-failed' });
		if (lookup.multipleMatches) return event.fail(409, { error: 'multiple-matches' });

		const desired = data.state ?? data.currentState;

		if (desired === 'deleted') {
			if (lookup.rule?.id) await deleteManagedRule(apiToken, accountId, lookup.rule.id, signal);
			return { ok: true as const };
		}

		const traffic = buildTraffic(data.kind, {
			categoryIds: data.categoryIds,
			// Synced lists are toggled from the lists table (`useToggleListPolicy` in `./layout.tsx`), never from this form - whatever the rule already references is carried through untouched, otherwise every category/location change here would silently drop them.
			listIds: lookup.rule ? parseTraffic(data.kind, lookup.rule.traffic).listIds : [],
			locationIds: data.kind === 'dns' && data.locationScope === 'selected' ? data.locationIds : [],
		});
		// Never send Cloudflare an empty `traffic` string - mirrors the client-side guard in `category-toggles.tsx`.
		if (!traffic) return event.fail(400, { error: 'empty-selection' });

		const enabled = desired === 'enabled';
		if (lookup.rule) await updateManagedRuleFull(apiToken, accountId, lookup.rule, { enabled, traffic }, signal);
		else await createManagedRule(apiToken, accountId, data.kind, { enabled, traffic }, signal);

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
			locationScope: z.enum(['all', 'selected']).optional().default('all'),
			locationIds: z.array(z.string()).optional().default([]),
		}),
	),
);

/**
 * Fetch -> parse -> limit -> create, then straight into the new list. Quota and duplicate-source checks happen against a fresh `lists.list()` read rather than the loader's snapshot, so two tabs can't both squeeze past the 100-list cap.
 */
export const useCreateList = routeAction$(
	async (data, event) => {
		const apiToken = await getActionCloudflareAccessToken(event);
		if (!apiToken) return event.fail(401, { error: 'no-token' });
		const accountId = event.params['accountId']!;
		const signal = (event.platform.request ?? event.request).signal;

		const existing = await findManagedLists(apiToken, accountId, signal);
		if (existing.failed) return event.fail(502, { error: 'lookup-failed' });
		if (existing.totalLists >= MAX_LISTS_PER_ACCOUNT) return event.fail(409, { error: 'quota' });

		const sourceUrl = data.url.trim();
		if (existing.lists.some((list) => list.meta?.url.toLowerCase() === sourceUrl.toLowerCase())) return event.fail(409, { error: 'duplicate' });

		let createdId: string | undefined;
		try {
			const { title, domains, meta } = await syncBlocklist(event, sourceUrl, data.overflow, data.limit);
			createdId = (await createManagedList(apiToken, accountId, { name: managedListNameFor(sourceUrl, title), meta, domains }, signal)).id;
		} catch (err) {
			const classified = classifySyncError(err);
			return event.fail(classified.status, { error: classified.error, message: classified.message });
		}
		if (!createdId) return event.fail(502, { error: 'cloudflare', message: 'Cloudflare returned a list without an id' });

		// Outside the try: `redirect()` works by throwing, and it must not be mistaken for a sync failure.
		throw event.redirect(302, `/${accountId}/lists/${createdId}/`);
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
		}),
	),
);

/**
 * Re-syncs every managed list with its own stored settings, all at once. Each list is its own `Promise.allSettled` slot, so one dead source URL or Cloudflare rejection only marks that row as failed - the rest still land. Workers bill CPU time, not wall time, so N concurrent fetch/parse/upload chains cost the same as one, but the parse work itself is still serial CPU per request (30s budget in wrangler.json) - very large source lists times many lists is where this would eventually hit the ceiling.
 */
export const useRefreshAllLists = routeAction$(async (_data, event) => {
	const apiToken = await getActionCloudflareAccessToken(event);
	if (!apiToken) return event.fail(401, { error: 'no-token' });
	const accountId = event.params['accountId']!;
	const signal = (event.platform.request ?? event.request).signal;

	const existing = await findManagedLists(apiToken, accountId, signal);
	if (existing.failed) return event.fail(502, { error: 'lookup-failed' });

	const refreshable = existing.lists.filter((list) => list.meta !== undefined);
	const outcomes = await Promise.allSettled(
		refreshable.map(async (list) => {
			const { domains, meta } = await syncBlocklist(event, list.meta!.url, list.meta!.overflow, list.meta!.limit);
			await replaceManagedListContents(apiToken, accountId, list, { meta, domains }, signal);
		}),
	);

	const failures = outcomes.flatMap((outcome, index) => {
		if (outcome.status === 'fulfilled') return [];
		// `classifySyncError` rethrows anything that isn't a fetch/parse or Cloudflare error - a genuine bug should still surface as a 500, not as a per-row note.
		const classified = classifySyncError(outcome.reason);
		return [{ name: refreshable[index]!.name, message: classified.message }];
	});

	return { ok: true as const, total: refreshable.length, succeeded: refreshable.length - failures.length, failures };
});

function policyState(lookup: ManagedRuleLookup): PolicyState {
	if (!lookup.rule) return 'deleted';
	return lookup.rule.enabled ? 'enabled' : 'disabled';
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
	const refreshAllAction = useRefreshAllLists();
	const toggleAction = useToggleListPolicy();

	const dnsLookup = rules.value.dns;
	const httpLookup = rules.value.http;

	const managedCategoryIds = categories.value.categories.map((category) => category.id);
	// A never-yet-created policy defaults to every resolved category so the first "Enabled" click produces a valid, non-empty rule - see the plan's tri-state/empty-expression notes.
	const dnsSelection = dnsLookup.rule ? parseTraffic('dns', dnsLookup.rule.traffic) : { categoryIds: managedCategoryIds, listIds: [], locationIds: [] as string[] };
	const httpSelection = httpLookup.rule ? parseTraffic('http', httpLookup.rule.traffic) : { categoryIds: managedCategoryIds, listIds: [] };

	const toggleFailure = actionFailure(toggleAction.value);
	const refreshAllFailure = actionFailure(refreshAllAction.value);

	return (
		<div class="flex flex-col gap-6">
			{/* Content-driven wrap instead of a viewport breakpoint: each card keeps shrinking (down to a comfortable minimum) and only drops to its own row once two no longer fit side by side. */}
			<div class="grid grid-cols-[repeat(auto-fit,minmax(min(22rem,100%),1fr))] gap-4">
				<TrafficPolicyCard kind="dns" accountId={accountId} title={m.gateway_dns_card_title()} state={policyState(dnsLookup)} multipleMatches={dnsLookup.multipleMatches} categories={categories.value.categories} categoriesFailed={categories.value.failed} initialCategoryIds={dnsSelection.categoryIds} listCount={dnsSelection.listIds.length} locations={dnsLocations.value.locations} locationsFailed={dnsLocations.value.failed} initialLocationScope={dnsSelection.locationIds.length > 0 ? 'selected' : 'all'} initialLocationIds={dnsSelection.locationIds} action={dnsAction} />

				<TrafficPolicyCard kind="http" accountId={accountId} title={m.gateway_http_card_title()} state={policyState(httpLookup)} multipleMatches={httpLookup.multipleMatches} categories={categories.value.categories} categoriesFailed={categories.value.failed} initialCategoryIds={httpSelection.categoryIds} listCount={httpSelection.listIds.length} action={httpAction} />
			</div>

			<section id="lists" class="flex flex-col gap-3">
				<header class="flex flex-wrap items-start justify-between gap-3">
					<div>
						<h2 class="text-kumo-strong text-lg font-semibold">{m.lists_title()}</h2>
						<p class="text-kumo-subtle mt-1 text-sm">{lists.value.failed ? m.lists_load_error() : m.lists_quota({ used: lists.value.totalLists.toLocaleString(), max: MAX_LISTS_PER_ACCOUNT.toLocaleString() })}</p>
					</div>
					<div class="flex flex-wrap items-center gap-2">
						<Form action={refreshAllAction}>
							<button type="submit" class={BUTTON_SECONDARY} disabled={refreshAllAction.isRunning || lists.value.lists.every((list) => list.meta === undefined)}>
								<LuRefreshCw class={['size-4', refreshAllAction.isRunning && 'animate-spin']} />
								{refreshAllAction.isRunning ? m.lists_refresh_all_running() : m.lists_refresh_all()}
							</button>
						</Form>
						<CreateListDialog quotaReached={!lists.value.failed && lists.value.totalLists >= MAX_LISTS_PER_ACCOUNT} action={createAction} />
					</div>
				</header>

				{refreshAllAction.value?.ok ? (
					<div class={refreshAllAction.value.failures.length > 0 ? 'text-kumo-danger text-sm' : 'text-kumo-subtle text-sm'}>
						<p>{m.lists_refresh_all_summary({ succeeded: refreshAllAction.value.succeeded.toLocaleString(), total: refreshAllAction.value.total.toLocaleString() })}</p>
						{refreshAllAction.value.failures.length > 0 ? (
							<ul class="mt-1 list-disc pl-5">
								{refreshAllAction.value.failures.map((failure) => (
									<li key={failure.name}>
										{failure.name}: {failure.message}
									</li>
								))}
							</ul>
						) : null}
					</div>
				) : null}
				{refreshAllFailure ? <p class="text-kumo-danger text-sm">{m.lists_error_generic()}</p> : null}

				{toggleFailure ? <p class="text-kumo-danger text-sm">{toggleFailure.error === 'multiple-matches' ? m.lists_error_policy_multiple() : m.lists_error_policy({ message: toggleFailure.message ?? '' })}</p> : null}

				<div class="bg-kumo-base ring-kumo-line overflow-x-auto rounded-lg shadow-xs ring">
					<table class="w-full min-w-[40rem] border-collapse">
						<thead class="border-kumo-line border-b">
							<tr>
								<th class={TH}>{m.lists_col_name()}</th>
								<th class={TH}>{m.lists_col_entries()}</th>
								<th class={TH}>{m.lists_col_updated()}</th>
								<th class={TH}>DNS</th>
								<th class={TH}>HTTP</th>
								<th class={TH}>{m.lists_col_source()}</th>
							</tr>
						</thead>
						<tbody class="divide-kumo-line divide-y">
							{lists.value.lists.length === 0 ? (
								<tr>
									<td colSpan={6} class="text-kumo-subtle px-3 py-8 text-center text-sm">
										{lists.value.failed ? m.lists_load_error() : m.lists_empty()}
									</td>
								</tr>
							) : (
								lists.value.lists.map((list) => {
									const href = `/${accountId}/lists/${list.id}/`;

									return (
										<tr key={list.id} class="hover:bg-kumo-tint cursor-pointer" onClick$={() => nav(href)}>
											<td class={TD}>
												<Link href={href} class="text-kumo-strong font-medium" onClick$={(event) => event.stopPropagation()}>
													{list.name}
												</Link>
												{list.meta ? null : <span class="text-kumo-subtle block text-xs">{m.lists_meta_missing()}</span>}
											</td>
											<td class={[TD, 'text-kumo-default whitespace-nowrap tabular-nums']}>
												{list.count?.toLocaleString() ?? '–'}
												{list.meta ? <span class="text-kumo-subtle"> / {list.meta.limit.toLocaleString()}</span> : null}
											</td>
											<td class={[TD, 'text-kumo-default whitespace-nowrap']}>{formatDateTime(list.meta?.fetchedAt ?? list.updatedAt, locale.value, timezone.value.long) ?? '–'}</td>
											<td class={TD}>
												<PolicyListToggle listId={list.id} kind="dns" included={ruleIncludesList(dnsLookup, 'dns', list.id)} label={m.lists_toggle_dns()} action={toggleAction} />
											</td>
											<td class={TD}>
												<PolicyListToggle listId={list.id} kind="http" included={ruleIncludesList(httpLookup, 'http', list.id)} label={m.lists_toggle_http()} action={toggleAction} />
											</td>
											<td class={[TD, 'max-w-xs']}>
												{list.meta ? (
													<a href={list.meta.url} target="_blank" rel="noreferrer" class="text-kumo-link inline-flex max-w-full items-center gap-1 underline" onClick$={(event) => event.stopPropagation()}>
														<span class="truncate">{list.meta.url}</span>
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
