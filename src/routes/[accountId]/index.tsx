import { component$ } from '@builder.io/qwik';
import { routeAction$, routeLoader$, useLocation, zod$, type DocumentHead } from '@builder.io/qwik-city';
import { TrafficPolicyCard } from '~/components/gateway/traffic-policy-card';
import { type PolicyState } from '~/components/gateway/tri-state-control';
import { getActionCloudflareAccessToken } from '~/lib/auth/cloudflare-token';
import { resolveManagedCategories } from '~/lib/gateway/categories';
import { listDnsLocations } from '~/lib/gateway/locations';
import { buildTraffic, parseTraffic } from '~/lib/gateway/policy-expression';
import { createManagedRule, deleteManagedRule, findManagedRule, updateManagedRuleFull, type ManagedRuleLookup } from '~/lib/gateway/rules';
import { useAuthToken } from '~/routes/layout';

// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore this gets generated automatically later in the build process
import * as m from '~/paraglide/messages';

export const head: DocumentHead = {
	title: 'Traffic Policies',
	meta: [
		{
			name: 'description',
			content: 'Manage this account’s DNS and HTTP traffic policies.',
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

/** The tri-state control's actual state is always this loader's read of Cloudflare's account, not local UI state - deleted when no managed rule exists, otherwise the rule's own `enabled` flag. */
// eslint-disable-next-line qwik/loader-location
const useManagedRules = routeLoader$(async ({ resolveValue, params, platform, request }) => {
	const failedLookup: ManagedRuleLookup = { rule: null, multipleMatches: false, failed: true };

	const token = await resolveValue(useAuthToken);
	if (!token?.cloudflare?.accessToken) return { dns: failedLookup, http: failedLookup };

	const accountId = params['accountId']!;
	const signal = (platform.request ?? request).signal;

	const [dns, http] = await Promise.all([findManagedRule(token.cloudflare.accessToken, accountId, 'dns', signal), findManagedRule(token.cloudflare.accessToken, accountId, 'http', signal)]);

	return { dns, http };
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
			listIds: [],
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

function policyState(lookup: ManagedRuleLookup): PolicyState {
	if (!lookup.rule) return 'deleted';
	return lookup.rule.enabled ? 'enabled' : 'disabled';
}

export default component$(() => {
	const location = useLocation();
	const accountId = location.params['accountId']!;

	const categories = useManagedCategories();
	const dnsLocations = useDnsLocations();
	const rules = useManagedRules();

	const dnsAction = useUpdatePolicy();
	const httpAction = useUpdatePolicy();

	const dnsLookup = rules.value.dns;
	const httpLookup = rules.value.http;

	const managedCategoryIds = categories.value.categories.map((category) => category.id);
	// A never-yet-created policy defaults to every resolved category so the first "Enabled" click produces a valid, non-empty rule - see the plan's tri-state/empty-expression notes.
	const dnsSelection = dnsLookup.rule ? parseTraffic('dns', dnsLookup.rule.traffic) : { categoryIds: managedCategoryIds, listIds: [], locationIds: [] as string[] };
	const httpSelection = httpLookup.rule ? parseTraffic('http', httpLookup.rule.traffic) : { categoryIds: managedCategoryIds, listIds: [] };

	// Content-driven wrap instead of a viewport breakpoint: each card keeps shrinking (down to a comfortable minimum) and only drops to its own row once two no longer fit side by side.
	return (
		<div class="grid grid-cols-[repeat(auto-fit,minmax(min(22rem,100%),1fr))] gap-4">
			<TrafficPolicyCard kind="dns" accountId={accountId} title={m.gateway_dns_card_title()} state={policyState(dnsLookup)} multipleMatches={dnsLookup.multipleMatches} categories={categories.value.categories} categoriesFailed={categories.value.failed} initialCategoryIds={dnsSelection.categoryIds} locations={dnsLocations.value.locations} locationsFailed={dnsLocations.value.failed} initialLocationScope={dnsSelection.locationIds.length > 0 ? 'selected' : 'all'} initialLocationIds={dnsSelection.locationIds} action={dnsAction} />

			<TrafficPolicyCard kind="http" accountId={accountId} title={m.gateway_http_card_title()} state={policyState(httpLookup)} multipleMatches={httpLookup.multipleMatches} categories={categories.value.categories} categoriesFailed={categories.value.failed} initialCategoryIds={httpSelection.categoryIds} action={httpAction} />
		</div>
	);
});
