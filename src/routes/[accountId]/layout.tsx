import { component$, Slot } from '@builder.io/qwik';
import { routeAction$, routeLoader$, zod$, type RequestHandler } from '@builder.io/qwik-city';
import { APIError } from 'cloudflare';
import * as zm from 'zod/mini';
import { getCloudflareAccessToken } from '~/lib/auth/cloudflare-token';
import { findManagedRules, setManagedRuleListMembership, type ManagedRuleLookup } from '~/lib/gateway/rules';
import { setIssueContext } from '~/lib/tracing';
import { useAuthToken } from '~/routes/layout';

export const onRequest: RequestHandler = ({ params, platform, redirect }) => {
	const validAccountId = zm.validate(
		/**
		 * @link https://developers.cloudflare.com/api/resources/accounts/#(resource)%20accounts%20%3E%20(model)%20account%20%3E%20(schema)
		 */
		zm.hex().check(zm.trim(), zm.length(32)),
		params['accountId'],
	);
	// Not valid account id
	if (!validAccountId) throw redirect(302, '/');

	setIssueContext(platform, { accountId: params['accountId'] });
};

/**
 * The managed DNS/HTTP rules, resolved once per request for every page under this account: the policy cards' tri-state is always this read of Cloudflare's account (deleted when no managed rule exists, otherwise the rule's own `enabled` flag), and the synced-list toggles (one pair per list row / detail header) derive membership from the same two lookups - never a lookup per row.
 */
export const useManagedRules = routeLoader$(async ({ resolveValue, params, platform, request }) => {
	const failedLookup: ManagedRuleLookup = { rule: null, multipleMatches: false, failed: true };

	const token = await resolveValue(useAuthToken);
	if (!token?.cloudflare?.accessToken) return { dns: failedLookup, http: failedLookup };

	const accountId = params['accountId']!;
	const signal = (platform.request ?? request).signal;

	return findManagedRules(token.cloudflare.accessToken, accountId, signal);
});

/**
 * Flips one synced source's membership in the managed DNS or HTTP rule - every Cloudflare list the source is chunked across, in one write. The checkbox is only present in the form data when checked, so a missing `included` means "remove".
 * See the `zod$` callback note on `useUpdatePolicy` in `./index.tsx` for why the schema is built from qwik-city's bundled zod.
 */
export const useToggleListPolicy = routeAction$(
	async (data, event) => {
		const apiToken = await getCloudflareAccessToken(event);
		if (!apiToken) return event.fail(401, { error: 'no-token' });

		try {
			const result = await setManagedRuleListMembership(apiToken, event.params['accountId']!, data.kind, data.listIds, data.included, (event.platform.request ?? event.request).signal);
			if (!result.ok) return event.fail(result.error === 'multiple-matches' ? 409 : 502, { error: result.error });
			return { ok: true as const };
		} catch (err) {
			if (err instanceof APIError) return event.fail(typeof err.status === 'number' ? err.status : 502, { error: 'cloudflare', message: err.message });
			throw err;
		}
	},
	zod$((z) =>
		z.object({
			listIds: z.array(z.string().uuid()).min(1),
			kind: z.enum(['dns', 'http']),
			included: z.coerce.boolean().optional().default(false),
		}),
	),
);

export default component$(() => <Slot />);
