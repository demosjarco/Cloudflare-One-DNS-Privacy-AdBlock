/**
 * @link https://developer.mozilla.org/en-US/docs/Web/API/Web_Periodic_Background_Synchronization_API
 * @link https://developer.chrome.com/docs/capabilities/periodic-background-sync
 */

import * as zm from 'zod/mini';

/** A tag is this prefix followed by the endpoint path (`listRefreshPath`), so the service worker has nothing to build from it. The worker can't import this module (see the note at the top of `routes/service-worker.ts`), so the prefix is duplicated there and must change together. */
const TAG_PREFIX = 'cfodpa-refresh:';
/** Blocklists change on the order of once a day; Chrome won't go below its own 12-hour floor anyway. */
export const PERIODIC_REFRESH_MIN_INTERVAL_MS = 24 * 60 * 60 * 1000;

/** `listRefreshPath` in reverse, one tuple slot per `/`-separated segment, with the id shapes the route layouts enforce (`[accountId]/layout.tsx`, `[listId]/layout.tsx`). */
const refreshPathSegmentsSchema = zm.tuple([zm.literal(''), zm.hex().check(zm.length(32)), zm.literal('lists'), zm.uuidv4(), zm.literal('refresh'), zm.literal('')]);

export interface PeriodicRefreshTarget {
	accountId: string;
	/** The group's primary (part 1) list id - it never changes on refresh, so the tag survives the group growing or shrinking. */
	listId: string;
}

/** The endpoint that re-syncs one source from its stored settings (`routes/[accountId]/lists/[listId]/refresh/index.ts`) - what both the service worker and the lists page's "Refresh all" call. Trailing slash on purpose: Qwik City redirects to the canonical form otherwise, and the service worker treats a redirect as "signed out". */
export function listRefreshPath(target: PeriodicRefreshTarget) {
	return `/${target.accountId.toLowerCase()}/lists/${target.listId.toLowerCase()}/refresh/`;
}

export function periodicRefreshTag(target: PeriodicRefreshTarget) {
	return `${TAG_PREFIX}${listRefreshPath(target)}`;
}

/** Whether a tag is one of this app's at all - parseable or not. */
export function isPeriodicRefreshTag(tag: string) {
	return tag.toLowerCase().startsWith(TAG_PREFIX);
}

export function parsePeriodicRefreshTag(tag: string): PeriodicRefreshTarget | undefined {
	if (!isPeriodicRefreshTag(tag)) return undefined;
	const segments = zm.safeParse(refreshPathSegmentsSchema, tag.slice(TAG_PREFIX.length).split('/'));
	if (!segments.success) return undefined;
	return { accountId: segments.data[1].toLowerCase(), listId: segments.data[3].toLowerCase() };
}

/**
 * - `'unsupported'`: the browser has no Periodic Background Sync API at all - decided purely by feature detection (`periodicSync` on the registration), never by browser name, so a browser that adds it later just works.
 * - `'install'`: the API exists but the permission isn't granted. In the browsers that have it today that means the app isn't installed as a PWA; a browser that grants it another way reads the same.
 * - `'unavailable'`: the API can't be reached because this page has no active service worker (registration refused, or still installing after a generous wait) - a transient state, not a verdict on the browser.
 */
export type PeriodicRefreshSupport = 'on' | 'install' | 'unsupported' | 'unavailable';
export type PeriodicRefreshAccess = { support: 'on'; manager: PeriodicSyncManager } | { support: Exclude<PeriodicRefreshSupport, 'on'> };

/**
 * Browser only. Waits for the service worker to be active (`ready`) - a promise that never settles when there's no registration at all (the dev server, where qwik-city's register snippet unregisters the worker; a browser that refused the registration), so it's given up on after `readyTimeoutMs` rather than hanging whatever awaits it. Callers that know they're on the dev server skip the wait with `isDev`.
 */
export async function openPeriodicRefresh(readyTimeoutMs = 5000): Promise<PeriodicRefreshAccess> {
	if (!('serviceWorker' in navigator)) return { support: 'unsupported' };

	const registration = await Promise.race([navigator.serviceWorker.ready, new Promise<undefined>((resolve) => setTimeout(resolve, readyTimeoutMs))]);
	if (!registration) return { support: 'unavailable' };
	const manager = registration.periodicSync;
	if (!manager) return { support: 'unsupported' };

	// The API is there, so a `permissions.query` that rejects the permission name is treated as "not granted", not as "unsupported" - the register call itself is what decides, and the switch surfaces its rejection.
	let granted: boolean;
	try {
		granted = (await navigator.permissions.query({ name: 'periodic-background-sync' as PermissionName })).state === 'granted';
	} catch {
		granted = false;
	}
	if (!granted) return { support: 'install' };

	return { support: 'on', manager };
}

/** The (lowercased) ids of the sources this browser refreshes for one account. */
export async function readPeriodicRefresh(manager: PeriodicSyncManager, accountId: string): Promise<string[]> {
	const tags = await manager.getTags();
	return tags.map(parsePeriodicRefreshTag).flatMap((target) => (target?.accountId === accountId.toLowerCase() ? [target.listId] : []));
}

/**
 * Drops registrations for sources that no longer exist on the account (deleted from this browser or another one), plus any tag of this app's that no longer parses (a format from another build - the worker ignores those rather than guessing, so this is where they're cleaned up), and returns what's left. Only ever called with the account's complete list of sources - with a partial one it would unregister the rest.
 */
export async function prunePeriodicRefresh(manager: PeriodicSyncManager, accountId: string, liveListIds: string[]): Promise<string[]> {
	const live = new Set(liveListIds.map((listId) => listId.toLowerCase()));
	const tags = await manager.getTags();

	const stale = tags.filter((tag) => {
		if (!isPeriodicRefreshTag(tag)) return false;
		const target = parsePeriodicRefreshTag(tag);
		return !target || (target.accountId === accountId.toLowerCase() && !live.has(target.listId));
	});
	await Promise.all(stale.map((tag) => manager.unregister(tag)));

	return tags.map(parsePeriodicRefreshTag).flatMap((target) => (target?.accountId === accountId.toLowerCase() && live.has(target.listId) ? [target.listId] : []));
}

export async function setPeriodicRefresh(manager: PeriodicSyncManager, target: PeriodicRefreshTarget, on: boolean): Promise<void> {
	const tag = periodicRefreshTag(target);
	if (on) await manager.register(tag, { minInterval: PERIODIC_REFRESH_MIN_INTERVAL_MS });
	else await manager.unregister(tag);
}

/* TypeScript's DOM/WebWorker libs don't ship the Periodic Background Sync API - these are the parts the pages touch (the worker's own slice is declared in `routes/service-worker.ts`). @link https://wicg.github.io/periodic-background-sync/ */
declare global {
	interface PeriodicSyncManager {
		register(tag: string, options?: { minInterval?: number }): Promise<void>;
		unregister(tag: string): Promise<void>;
		getTags(): Promise<string[]>;
	}

	interface ServiceWorkerRegistration {
		/** Absent in browsers without the API - the feature detection `openPeriodicRefresh` relies on. */
		readonly periodicSync?: PeriodicSyncManager;
	}
}
