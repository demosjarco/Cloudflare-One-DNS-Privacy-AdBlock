import type { RequestEventAction } from '@builder.io/qwik-city';
import { APIError } from 'cloudflare';
import { BlocklistFetchError, fetchPiholeBlocklist, type OverflowStrategy } from '~/lib/blocklist/pihole';
import type { ManagedListMeta } from '~/lib/gateway/lists';

export type ListSyncErrorCode = 'fetch-http' | 'fetch-network' | 'fetch-empty' | 'fetch-too-large' | 'cloudflare';

/**
 * Shared by create and refresh: pull the source with this app's `User-Agent`, apply the limit, and stamp the metadata that gets written into the list description.
 *
 * The `User-Agent` lets list maintainers see who's pulling and from where - live on Workers it resolves to e.g. `cfodpa/163111b (Linux; x86_64) Workers/2026-09-11 (+https://github.com/...)`. `node:os` and `wrangler.json` are imported lazily: `node:os` only exists under `nodejs_compat` (and isn't in Vite's externals list, so a static import would get pulled into the client manifest scan), and the JSON is only wanted for its `compatibility_date`.
 */
export async function syncBlocklist(event: RequestEventAction, url: string, overflow: OverflowStrategy, limit: number) {
	const [{ machine, release, type }, { compatibility_date }] = await Promise.all([import('node:os'), import('../../../wrangler.json')]);
	const details = [[type(), release()].filter((part) => part.trim().length > 0).join(' '), machine()].filter((part) => part.trim().length > 0).join('; ');
	const userAgent = [`cfodpa/${event.platform.env.GIT_HASH?.substring(0, 7) ?? 'local'}`, details.length > 0 ? `(${details})` : undefined, `Workers/${compatibility_date}`, '(+https://github.com/demosjarco/Cloudflare-One-DNS-Privacy-AdBlock)'].filter((part) => part !== undefined).join(' ');

	const signal = (event.platform.request ?? event.request).signal;
	const fetched = await fetchPiholeBlocklist(url, { userAgent, limit, overflow, signal });

	const meta: ManagedListMeta = { v: 1, url, fetchedAt: new Date().toISOString(), overflow, limit, sourceCount: fetched.sourceCount };
	return { title: fetched.title, domains: fetched.domains, meta };
}

/** Maps the two error families an action can hit (blocklist fetch/parse, Cloudflare API) to a stable code + the upstream message, for `event.fail`. Anything else is a genuine bug and is rethrown. */
export function classifySyncError(err: unknown): { status: number; error: ListSyncErrorCode; message: string } {
	if (err instanceof BlocklistFetchError) {
		const status = err.code === 'too-large' ? 413 : 422;
		return { status, error: `fetch-${err.code}` as const, message: err.message };
	}
	if (err instanceof APIError) return { status: typeof err.status === 'number' ? err.status : 502, error: 'cloudflare', message: err.message };
	throw err;
}
