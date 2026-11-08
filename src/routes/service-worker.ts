/**
 * Runs the periodic background refresh registered by the lists UI - see `lib/periodic-refresh.ts` for the design and the registration side.
 *
 * No imports, on purpose. qwik-city registers this file as a classic (non-module) worker, and anything it shares with page code (`zod/mini` included - it's already in a client chunk) is emitted as a chunk under `/build/` that this root-level script would reference by the wrong relative path. So `TAG_PREFIX` is duplicated from `lib/periodic-refresh.ts` and must change together, and the tag carries the endpoint path itself: this side only checks that it is a path on this origin, and the ids in it are validated where every request's are - by the route layouts (`[accountId]/layout.tsx`, `[listId]/layout.tsx`, with `zod/mini`), which answer a malformed one with a redirect this worker reports as a failure.
 */

/** Must match `TAG_PREFIX` in `lib/periodic-refresh.ts`. */
const TAG_PREFIX = 'cfodpa-refresh:';

self.addEventListener('install', () => self.skipWaiting());

self.addEventListener('activate', () => self.clients.claim());

/** One event per synced source. A tag that isn't one of this app's, or doesn't resolve to a plain path on this origin (the tag is the only input this worker ever acts on), is ignored rather than unregistered: the lists page is where stale tags get cleaned up (`prunePeriodicRefresh`). */
self.addEventListener('periodicsync', (event) => {
	if (!event.tag.toLowerCase().startsWith(TAG_PREFIX)) return;
	const path = event.tag.slice(TAG_PREFIX.length);
	// Resolving against this origin and comparing back catches everything that isn't a clean absolute path here: another origin, a protocol-relative `//host`, a relative path, `..` segments, a query or fragment.
	const url = new URL(path, self.location.origin);
	if (url.origin !== self.location.origin || url.pathname !== path) return;

	event.waitUntil(refreshList(event.tag, path));
});

/**
 * The same-origin `fetch` carries the session cookie (and stores the refreshed one the auth plugin sets, which is what keeps the session alive between visits). `redirect: 'manual'` matters: a signed-out request is answered with a 307 to the sign-in page, and following it would re-POST to the auth handler and come back as a 200 HTML page that looked like success.
 *
 * Only a `404` - the source no longer exists (deleted from another browser, or from this one with the page never revisited) - ends the schedule; the user's Auto refresh choice is the registration, so it's only dropped when it can never apply again. Everything else, a signed-out session included, rejects: the failure shows in DevTools, Chrome tries again at the next slot, and the run succeeds on its own once the user is signed in again - no switches to re-flip.
 */
async function refreshList(tag: string, path: string) {
	const response = await fetch(path, { method: 'POST', credentials: 'same-origin', redirect: 'manual', headers: { accept: 'application/json' } });

	if (response.status === 404) {
		await self.registration.periodicSync?.unregister(tag);
		return;
	}
	if (!response.ok) throw new Error(`Periodic refresh via ${path} failed: ${response.type === 'opaqueredirect' ? 'redirected (signed out?)' : `HTTP ${response.status}`}`);
}

/* Not shipped by TypeScript's WebWorker lib. `ServiceWorkerRegistration.periodicSync` is already declared globally by `lib/periodic-refresh.ts` (same TypeScript program, no runtime import needed); the event is only ever seen here. */
interface PeriodicSyncEvent extends ExtendableEvent {
	readonly tag: string;
}

declare global {
	interface ServiceWorkerGlobalScopeEventMap {
		periodicsync: PeriodicSyncEvent;
	}
}

declare const self: ServiceWorkerGlobalScope;

export {};
