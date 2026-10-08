import { component$ } from '@builder.io/qwik';
import { Form, Link, routeAction$, routeLoader$, useLocation, zod$, type DocumentHead } from '@builder.io/qwik-city';
import { LuArrowLeft, LuExternalLink, LuRefreshCw, LuTrash2 } from '@qwikest/icons/lucide';
import { PolicyListToggle } from '~/components/lists/policy-list-toggle';
import { actionFailure, BUTTON_DANGER, BUTTON_PRIMARY, ENTRY_LIMIT_SUGGESTIONS, INPUT, OVERFLOW_OPTIONS, SELECT } from '~/components/lists/shared';
import { OVERFLOW_STRATEGIES } from '~/lib/blocklist/pihole';
import { getActionCloudflareAccessToken } from '~/lib/auth/cloudflare-token';
import { formatDateTime } from '~/lib/format-date';
import { classifySyncError, syncBlocklist } from '~/lib/gateway/list-sync';
import { deleteManagedList, getManagedList, isValidEntryLimit, listManagedListItems, replaceManagedListContents, SUGGESTED_ENTRY_LIMITS } from '~/lib/gateway/lists';
import { ruleIncludesList, setManagedRuleListMembership } from '~/lib/gateway/rules';
import { useAuthToken, useLocale, useTimezone } from '~/routes/layout';
import { useManagedRules, useToggleListPolicy } from '../../layout';

// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore this gets generated automatically later in the build process
import * as m from '~/paraglide/messages';

export const head: DocumentHead = ({ resolveValue }) => {
	const detail = resolveValue(useManagedListDetail);
	return {
		title: detail.list?.name ?? 'List',
		meta: [
			{
				name: 'description',
				content: 'Entries and sync settings for one synced blocklist.',
			},
		],
	};
};

/** The list record and its items come from two different endpoints (`GET /lists/{id}` carries no items) - fetched in parallel. A list that exists but isn't this app's resolves to `null` exactly like a missing one (see `getManagedList`). */
// eslint-disable-next-line qwik/loader-location
const useManagedListDetail = routeLoader$(async ({ resolveValue, params, platform, request }) => {
	const token = await resolveValue(useAuthToken);
	if (!token?.cloudflare?.accessToken) return { list: null, items: [], failed: true };

	const accountId = params['accountId']!;
	const listId = params['listId']!;
	const signal = (platform.request ?? request).signal;

	const [{ list, failed }, items] = await Promise.all([getManagedList(token.cloudflare.accessToken, accountId, listId, signal), listManagedListItems(token.cloudflare.accessToken, accountId, listId, signal)]);
	return { list, items: list ? items.items : [], failed: failed || (list !== null && items.failed) };
});

/** Re-pulls the source with the (possibly just changed) entry limit and overflow strategy and replaces the list's entries + description wholesale. The URL itself is never editable - a different source is a different list. */
export const useRefreshList = routeAction$(
	async (data, event) => {
		const apiToken = await getActionCloudflareAccessToken(event);
		if (!apiToken) return event.fail(401, { error: 'no-token' });
		const accountId = event.params['accountId']!;
		const signal = (event.platform.request ?? event.request).signal;

		const { list, failed } = await getManagedList(apiToken, accountId, event.params['listId']!, signal);
		if (failed) return event.fail(502, { error: 'lookup-failed' });
		if (!list?.meta) return event.fail(404, { error: 'not-found' });

		try {
			const { domains, meta } = await syncBlocklist(event, list.meta.url, data.overflow, data.limit);
			await replaceManagedListContents(apiToken, accountId, list, { meta, domains }, signal);
			return { ok: true as const };
		} catch (err) {
			const classified = classifySyncError(err);
			return event.fail(classified.status, { error: classified.error, message: classified.message });
		}
	},
	zod$((z) =>
		z.object({
			overflow: z.enum(OVERFLOW_STRATEGIES),
			limit: z.coerce.number().refine(isValidEntryLimit),
		}),
	),
);

/**
 * Cloudflare's docs don't say whether a list referenced by a policy can be deleted, so this never relies on a cascade: the list is pulled out of both managed rules first (a rule left with nothing to match is deleted - see `setManagedRuleListMembership`), and only then is the list itself removed.
 */
export const useDeleteList = routeAction$(async (_data, event) => {
	const apiToken = await getActionCloudflareAccessToken(event);
	if (!apiToken) return event.fail(401, { error: 'no-token' });
	const accountId = event.params['accountId']!;
	const listId = event.params['listId']!;
	const signal = (event.platform.request ?? event.request).signal;

	const { list, failed } = await getManagedList(apiToken, accountId, listId, signal);
	if (failed) return event.fail(502, { error: 'lookup-failed' });
	if (!list) return event.fail(404, { error: 'not-found' });

	try {
		for (const kind of ['dns', 'http'] as const) {
			const result = await setManagedRuleListMembership(apiToken, accountId, kind, listId, false, signal);
			if (!result.ok) return event.fail(result.error === 'multiple-matches' ? 409 : 502, { error: result.error });
		}
		await deleteManagedList(apiToken, accountId, listId, signal);
	} catch (err) {
		const classified = classifySyncError(err);
		return event.fail(classified.status, { error: classified.error, message: classified.message });
	}

	throw event.redirect(302, `/${accountId}/#lists`);
});

function describeFailure(error: string | undefined, message: string | undefined) {
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
			return m.lists_error_invalid_limit();
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

	const list = detail.value.list;
	const backLink = (
		<Link href={`/${accountId}/#lists`} class="text-kumo-link inline-flex items-center gap-1 text-sm underline">
			<LuArrowLeft class="size-3.5" />
			{m.lists_back()}
		</Link>
	);

	if (!list) {
		return (
			<div class="flex flex-col gap-4">
				{backLink}
				<p class={detail.value.failed ? 'text-kumo-danger text-sm' : 'text-kumo-subtle text-sm'}>{detail.value.failed ? m.lists_load_error() : m.lists_detail_not_found()}</p>
			</div>
		);
	}

	const meta = list.meta;
	const fetchedAt = formatDateTime(meta?.fetchedAt ?? list.updatedAt, locale.value, timezone.value.long);
	const entryCount = detail.value.items.length;
	const truncated = meta !== undefined && meta.sourceCount > entryCount;
	const failure = [refreshAction.value, deleteAction.value, toggleAction.value]
		.map(actionFailure)
		.map((failed) => (failed ? describeFailure(failed.validation ? 'validation' : failed.error, failed.message) : undefined))
		.find((text) => text !== undefined);

	return (
		<div class="flex flex-col gap-4">
			{backLink}

			<header class="bg-kumo-base ring-kumo-line flex flex-col gap-4 rounded-lg p-4 shadow-xs ring">
				<div class="flex flex-wrap items-start justify-between gap-3">
					<div class="min-w-0">
						<h1 class="text-kumo-strong truncate text-xl font-semibold">{list.name}</h1>
						<p class="text-kumo-subtle text-sm">
							{meta ? m.lists_entries({ count: entryCount.toLocaleString(), limit: meta.limit.toLocaleString() }) : entryCount.toLocaleString()}
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
							<PolicyListToggle listId={list.id} kind="dns" included={ruleIncludesList(rules.value.dns, 'dns', list.id)} label={m.lists_toggle_dns()} action={toggleAction} />
						</dd>
					</div>
					<div>
						<dt class={FIELD_LABEL}>{m.lists_toggle_http()}</dt>
						<dd class="mt-1">
							<PolicyListToggle listId={list.id} kind="http" included={ruleIncludesList(rules.value.http, 'http', list.id)} label={m.lists_toggle_http()} action={toggleAction} />
						</dd>
					</div>
				</dl>
			</header>

			<section class="bg-kumo-base ring-kumo-line overflow-hidden rounded-lg shadow-xs ring">
				<h2 class="text-kumo-strong border-kumo-line border-b px-3 py-2 text-base font-semibold">{m.lists_detail_entries_heading()}</h2>
				{detail.value.items.length === 0 ? (
					<p class="text-kumo-subtle px-3 py-8 text-center text-sm">{m.lists_detail_no_entries()}</p>
				) : (
					<table class="w-full border-collapse">
						<thead class="border-kumo-line border-b">
							<tr>
								<th class="text-kumo-subtle w-16 px-3 py-2 text-right text-xs font-medium tracking-wide uppercase">#</th>
								<th class="text-kumo-subtle px-3 py-2 text-left text-xs font-medium tracking-wide uppercase">{m.lists_col_hostname()}</th>
							</tr>
						</thead>
						<tbody class="divide-kumo-line divide-y">
							{detail.value.items.map((item, index) => (
								<tr key={item.value ?? index}>
									<td class="text-kumo-subtle px-3 py-1.5 text-right font-mono text-xs tabular-nums">{index + 1}</td>
									<td class="text-kumo-default px-3 py-1.5 font-mono text-sm break-all">{item.value}</td>
								</tr>
							))}
						</tbody>
					</table>
				)}
			</section>
		</div>
	);
});
