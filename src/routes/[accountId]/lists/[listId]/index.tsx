import { component$ } from '@builder.io/qwik';
import { Form, Link, routeAction$, routeLoader$, useLocation, zod$, type DocumentHead } from '@builder.io/qwik-city';
import { LuArrowLeft, LuExternalLink, LuRefreshCw, LuTrash2 } from '@qwikest/icons/lucide';
import { ListEntriesTable } from '~/components/lists/chunk-entries';
import { PolicyListToggle } from '~/components/lists/policy-list-toggle';
import { actionFailure, BUTTON_DANGER, BUTTON_PRIMARY, ENTRY_LIMIT_SUGGESTIONS, INPUT, OVERFLOW_OPTIONS, SELECT } from '~/components/lists/shared';
import { getCloudflareAccessToken } from '~/lib/auth/cloudflare-token';
import { OVERFLOW_STRATEGIES } from '~/lib/blocklist/pihole';
import { formatDateTime } from '~/lib/format-date';
import { classifySyncError, deleteListGroup, effectiveMaxLists, syncListGroup } from '~/lib/gateway/list-sync';
import { findGroupByListId, findManagedLists, isValidEntryLimit, MAX_LISTS_PER_ACCOUNT, SUGGESTED_ENTRY_LIMITS, type ManagedListGroup } from '~/lib/gateway/lists';
import { ruleIncludesAllLists } from '~/lib/gateway/rules';
import { useAuthToken, useLocale, useTimezone } from '~/routes/layout';
import { useManagedRules, useToggleListPolicy } from '../../layout';

// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore this gets generated automatically later in the build process
import * as m from '~/paraglide/messages';

export const head: DocumentHead = ({ resolveValue }) => {
	const detail = resolveValue(useManagedListDetail);
	return {
		title: detail.group?.primary.name ?? m.page_title_list(),
		meta: [
			{
				name: 'description',
				content: m.page_description_list(),
			},
		],
	};
};

interface ListDetail {
	group: ManagedListGroup | undefined;
	/** Every list on the account, for the "max lists" ceiling. */
	totalLists: number;
	failed: boolean;
}

/**
 * The route's id can be any chunk of a source, so the group is resolved from the account's full list read rather than `GET /lists/{id}` - a list that isn't this app's is `undefined` exactly like a missing one. No entries are loaded here: each page section below fetches its own 1,000 when expanded (see `chunk-entries.tsx`), so opening a source spread over fifteen lists costs one request, not ninety.
 */
// eslint-disable-next-line qwik/loader-location
const useManagedListDetail = routeLoader$(async ({ resolveValue, params, platform, request }): Promise<ListDetail> => {
	const token = await resolveValue(useAuthToken);
	if (!token?.cloudflare?.accessToken) return { group: undefined, totalLists: 0, failed: true };

	const lookup = await findManagedLists(token.cloudflare.accessToken, params['accountId']!, (platform.request ?? request).signal);
	const group = lookup.failed ? undefined : findGroupByListId(lookup, params['listId']!);
	return { group, totalLists: lookup.totalLists, failed: lookup.failed };
});

/** Re-pulls the source with the (possibly just changed) entry limit, list ceiling and overflow strategy and reconciles every chunk - see `syncListGroup`. The URL itself is never editable - a different source is a different list. */
export const useRefreshList = routeAction$(
	async (data, event) => {
		const apiToken = await getCloudflareAccessToken(event);
		if (!apiToken) return event.fail(401, { error: 'no-token' });
		const accountId = event.params['accountId']!;
		const signal = (event.platform.request ?? event.request).signal;

		const lookup = await findManagedLists(apiToken, accountId, signal);
		if (lookup.failed) return event.fail(502, { error: 'lookup-failed' });
		const group = findGroupByListId(lookup, event.params['listId']!);
		if (!group?.meta) return event.fail(404, { error: 'not-found' });

		try {
			const result = await syncListGroup(event, apiToken, accountId, { url: group.meta.url, overflow: data.overflow, limit: data.limit, maxLists: data.maxLists, existing: group.chunks, totalLists: lookup.totalLists }, signal);
			// The primary never changes on refresh (part 1 is updated in place), so no redirect is needed even when the group was reached through another chunk's id.
			return { ok: true as const, parts: result.parts };
		} catch (err) {
			const classified = classifySyncError(err);
			return event.fail(classified.status, { error: classified.error, message: classified.message });
		}
	},
	zod$((z) =>
		z.object({
			overflow: z.enum(OVERFLOW_STRATEGIES),
			limit: z.coerce.number().refine(isValidEntryLimit),
			maxLists: z.coerce.number().int().min(1).max(MAX_LISTS_PER_ACCOUNT),
		}),
	),
);

/** Removes every chunk of the source - out of both managed rules first, then the lists themselves (see `deleteListGroup`). */
export const useDeleteList = routeAction$(async (_data, event) => {
	const apiToken = await getCloudflareAccessToken(event);
	if (!apiToken) return event.fail(401, { error: 'no-token' });
	const accountId = event.params['accountId']!;
	const signal = (event.platform.request ?? event.request).signal;

	const lookup = await findManagedLists(apiToken, accountId, signal);
	if (lookup.failed) return event.fail(502, { error: 'lookup-failed' });
	const group = findGroupByListId(lookup, event.params['listId']!);
	if (!group) return event.fail(404, { error: 'not-found' });

	try {
		await deleteListGroup(apiToken, accountId, group.chunks, signal);
	} catch (err) {
		const classified = classifySyncError(err);
		return event.fail(classified.status, { error: classified.error, message: classified.message });
	}

	throw event.redirect(302, `/${accountId}/#lists`);
});

function describeFailure(error: string | undefined, message: string | undefined, invalidFields: string[]) {
	switch (error) {
		case 'fetch-http':
			return m.lists_error_fetch_http();
		case 'fetch-network':
			return m.lists_error_fetch_network();
		case 'fetch-empty':
			return m.lists_error_fetch_empty();
		case 'fetch-too-large':
			return m.lists_error_fetch_too_large();
		case 'cloudflare':
			return m.lists_error_cloudflare({ message: message ?? '' });
		case 'multiple-matches':
			return m.lists_error_policy_multiple();
		case 'validation':
			return invalidFields.includes('maxLists') ? m.lists_error_invalid_max_lists() : m.lists_error_invalid_limit();
		case undefined:
			return undefined;
		default:
			return m.lists_error_generic();
	}
}

const FIELD_LABEL = 'text-kumo-subtle text-xs font-medium tracking-wide uppercase';

export default component$(() => {
	const location = useLocation();
	const accountId = location.params['accountId']!;

	const detail = useManagedListDetail();
	const rules = useManagedRules();
	const locale = useLocale();
	const timezone = useTimezone();

	const refreshAction = useRefreshList();
	const deleteAction = useDeleteList();
	const toggleAction = useToggleListPolicy();

	const group = detail.value.group;
	const backLink = (
		<Link prefetch="js" href={`/${accountId}/#lists`} class="text-kumo-link inline-flex items-center gap-1 text-sm underline">
			<LuArrowLeft class="size-3.5" />
			{m.lists_back()}
		</Link>
	);

	if (!group) {
		return (
			<div class="flex flex-col gap-4">
				{backLink}
				<p class={detail.value.failed ? 'text-kumo-danger text-sm' : 'text-kumo-subtle text-sm'}>{detail.value.failed ? m.lists_load_error() : m.lists_detail_not_found()}</p>
			</div>
		);
	}

	const meta = group.meta;
	const chunkIds = group.chunks.map((chunk) => chunk.id);
	const fetchedAt = formatDateTime(meta?.fetchedAt ?? group.primary.updatedAt, locale.value, timezone.value.long);
	// Cloudflare's own per-list `count`, summed - entries themselves are never loaded for the header.
	const entryCount = group.count;
	const capacity = meta ? meta.limit * meta.maxLists : undefined;
	const truncated = meta !== undefined && entryCount !== undefined && meta.sourceCount > entryCount;
	// The group's own slots are reusable, so the ceiling is what's free plus what it already holds.
	const maxListsCeiling = Math.max(group.chunks.length, effectiveMaxLists(MAX_LISTS_PER_ACCOUNT, detail.value.totalLists, group.chunks.length));
	const failure = [refreshAction.value, deleteAction.value, toggleAction.value]
		.map(actionFailure)
		.map((failed) => (failed ? describeFailure(failed.validation ? 'validation' : failed.error, failed.message, failed.invalidFields) : undefined))
		.find(Boolean);

	return (
		<div class="flex flex-col gap-4">
			{backLink}

			<header class="bg-kumo-base ring-kumo-line flex flex-col gap-4 rounded-lg p-4 shadow-xs ring">
				<div class="flex flex-wrap items-start justify-between gap-3">
					<div class="min-w-0">
						<h1 class="text-kumo-strong truncate text-xl font-semibold">{group.primary.name}</h1>
						<p class="text-kumo-subtle text-sm">
							{capacity !== undefined ? m.lists_entries({ count: entryCount?.toLocaleString() ?? '–', limit: capacity.toLocaleString() }) : (entryCount?.toLocaleString() ?? '–')}
							{meta ? ` · ${m.lists_chunks({ used: group.chunks.length.toLocaleString(), max: meta.maxLists.toLocaleString() })}` : null}
							{truncated ? ` ${m.lists_truncated({ source: meta.sourceCount.toLocaleString() })}` : null}
						</p>
					</div>

					<div class="flex flex-wrap items-center gap-2">
						{/* Settings only mean anything in terms of what's actually uploaded, so they're applied by Refresh (a re-sync) rather than saved on their own. */}
						<Form action={refreshAction} class="flex flex-wrap items-center gap-2">
							<input type="number" name="limit" {...{ list: 'detail-entry-limits' }} aria-label={m.lists_limit_label()} min={SUGGESTED_ENTRY_LIMITS.standard} step={1} required value={meta?.limit} class={[INPUT, 'w-28']} disabled={!meta || refreshAction.isRunning} />
							<datalist id="detail-entry-limits">
								{ENTRY_LIMIT_SUGGESTIONS.map((option) => (
									<option key={option.value} value={option.value}>
										{option.label}
									</option>
								))}
							</datalist>
							<label class="text-kumo-subtle inline-flex items-center gap-1.5 text-sm">
								<span>×</span>
								<input type="number" name="maxLists" aria-label={m.lists_max_lists_label()} min={1} max={maxListsCeiling} step={1} required value={meta?.maxLists} class={[INPUT, 'w-20']} disabled={!meta || refreshAction.isRunning} />
								<span>{m.lists_max_lists_unit()}</span>
							</label>
							<select name="overflow" aria-label={m.lists_overflow_label()} class={[SELECT, 'w-auto']} disabled={!meta || refreshAction.isRunning}>
								{OVERFLOW_OPTIONS.map((option) => (
									<option key={option.value} value={option.value} selected={option.value === meta?.overflow}>
										{option.label}
									</option>
								))}
							</select>
							<button type="submit" class={BUTTON_PRIMARY} disabled={!meta || refreshAction.isRunning}>
								<LuRefreshCw class={['size-4', refreshAction.isRunning && 'animate-spin']} />
								{refreshAction.isRunning ? m.lists_refreshing() : m.lists_refresh()}
							</button>
						</Form>

						<Form action={deleteAction}>
							<button
								type="submit"
								class={BUTTON_DANGER}
								disabled={deleteAction.isRunning}
								onClick$={(event) => {
									if (!confirm(m.lists_delete_confirm())) event.preventDefault();
								}}>
								<LuTrash2 class="size-4" />
								{m.lists_delete()}
							</button>
						</Form>
					</div>
				</div>

				{failure ? <p class="text-kumo-danger text-sm">{failure}</p> : null}
				{rules.value.dns.failed || rules.value.http.failed ? <p class="text-kumo-danger text-sm">{m.lists_rules_load_error()}</p> : null}

				<dl class="grid grid-cols-[repeat(auto-fit,minmax(min(14rem,100%),1fr))] gap-x-6 gap-y-3 text-sm">
					<div class="min-w-0">
						<dt class={FIELD_LABEL}>{m.lists_col_source()}</dt>
						<dd class="mt-0.5">
							{meta ? (
								<a href={meta.url} target="_blank" rel="noreferrer" class="text-kumo-link inline-flex max-w-full items-center gap-1 underline">
									<span class="truncate">{meta.url}</span>
									<LuExternalLink class="size-3.5 shrink-0" />
								</a>
							) : (
								<span class="text-kumo-subtle">{m.lists_meta_missing()}</span>
							)}
						</dd>
					</div>
					<div>
						<dt class={FIELD_LABEL}>{m.lists_fetched_at()}</dt>
						<dd class="text-kumo-default mt-0.5">{fetchedAt ?? '–'}</dd>
					</div>
					<div>
						<dt class={FIELD_LABEL}>{m.lists_toggle_dns()}</dt>
						<dd class="mt-1">
							<PolicyListToggle listIds={chunkIds} kind="dns" included={ruleIncludesAllLists(rules.value.dns, 'dns', chunkIds)} label={m.lists_toggle_dns()} action={toggleAction} />
						</dd>
					</div>
					<div>
						<dt class={FIELD_LABEL}>{m.lists_toggle_http()}</dt>
						<dd class="mt-1">
							<PolicyListToggle listIds={chunkIds} kind="http" included={ruleIncludesAllLists(rules.value.http, 'http', chunkIds)} label={m.lists_toggle_http()} action={toggleAction} />
						</dd>
					</div>
				</dl>
			</header>

			{/* `overflow-clip`, not `overflow-hidden`: hidden makes the card a scroll container, which would pin the sticky part headers inside it instead of to the viewport. */}
			<section class="bg-kumo-base ring-kumo-line overflow-clip rounded-lg shadow-xs ring">
				<h2 class="text-kumo-strong border-kumo-line border-b px-3 py-2 text-base font-semibold">{m.lists_detail_entries_heading()}</h2>
				<ListEntriesTable accountId={accountId} chunks={group.chunks} />
			</section>
		</div>
	);
});
