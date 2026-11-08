import type { RequestHandler } from '@builder.io/qwik-city';
import { getCloudflareAccessToken } from '~/lib/auth/cloudflare-token';
import { classifySyncError, syncListGroup } from '~/lib/gateway/list-sync';
import { findGroupByListId, findManagedLists } from '~/lib/gateway/lists';

/**
 * Re-syncs one source from the settings stored on its list - the same sync the detail page's "Refresh" runs, minus the form. Called once per source, concurrently, by both the service worker's periodic refresh (`routes/service-worker.ts`) and the lists page's "Refresh all" (`routes/[accountId]/index.tsx`): one request per source gives each its own Worker CPU budget (30s in wrangler.json, previously shared by every source of a "refresh all") and, for the service worker, its own 3-minute `periodicsync` window. A plain endpoint rather than a `routeAction$` because an action is addressed by a build-time hash in `?qaction=`, which a service worker can't know.
 *
 * Auth is exactly the page's: the session cookie rides along on a same-origin fetch, and the root layout's `onRequest` redirects a signed-out request before this runs. The `Origin` check below is the same one Qwik City applies to form posts, which skip this endpoint's bodiless request - the session cookie is `SameSite=Lax`, so a cross-site POST wouldn't carry it anyway, but a second line costs one header compare. The one status the service worker acts on is `404` (the source is gone - the schedule is dropped); everything else, a signed-out redirect included, is simply tried again at the next slot.
 *
 * The whole sync happens inside this request on purpose: Chrome caps a `periodicsync` event at 3 minutes and `ctx.waitUntil` only buys 30 seconds after the response, so there's nothing to hand the work off to. If the caller goes away first, the disconnect aborts `signal` (`enable_request_signal`) and the next run adopts whatever this one left - see `syncListGroup`.
 */
export const onPost: RequestHandler = async (event) => {
	event.headers.set('Cache-Control', 'no-store');

	if (event.request.headers.get('origin') !== event.url.origin) {
		event.json(403, { error: 'cross-origin' });
		return;
	}

	const apiToken = await getCloudflareAccessToken(event.request, event.platform, event.url, event.sharedMap);
	if (!apiToken) {
		event.json(401, { error: 'no-token' });
		return;
	}
	const accountId = event.params['accountId']!;
	const signal = (event.platform.request ?? event.request).signal;

	const lookup = await findManagedLists(apiToken, accountId, signal);
	if (lookup.failed) {
		event.json(502, { error: 'lookup-failed' });
		return;
	}
	const group = findGroupByListId(lookup, event.params['listId']!);
	if (!group?.meta) {
		event.json(404, { error: 'not-found' });
		return;
	}

	try {
		const { url, overflow, limit, maxLists } = group.meta;
		const result = await syncListGroup(event, apiToken, accountId, { url, overflow, limit, maxLists, existing: group.chunks, totalLists: lookup.totalLists }, signal);
		event.json(200, { ok: true, parts: result.parts, count: result.count });
	} catch (err) {
		const classified = classifySyncError(err);
		event.json(classified.status, { error: classified.error, message: classified.message });
	}
};
