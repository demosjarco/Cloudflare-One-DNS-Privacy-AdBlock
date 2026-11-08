import { getToken, type JWT } from '@auth/core/jwt';
import type { Account } from '@auth/core/types';
import type { RequestEventBase } from '@builder.io/qwik-city';

export interface CloudflareTokenSet {
	accessToken: string;
	refreshToken?: string;
	/** Absolute unix timestamp (seconds) the access token expires at. */
	expiresAt: number;
}

declare module '@auth/core/jwt' {
	interface JWT {
		cloudflare?: CloudflareTokenSet;
	}
}

/** @link https://developers.cloudflare.com/fundamentals/oauth/integrate-with-cloudflare/ */
const TOKEN_ENDPOINT = 'https://dash.cloudflare.com/oauth2/token';

/** `sharedMap` key the `jwt` callback in `~/routes/plugin@auth.ts` writes this request's final (post-refresh) JWT to. */
export const SESSION_JWT_KEY = 'sessionJwt';

/**
 * The JWT for this request, as the `jwt` callback left it - including a Cloudflare token set it just refreshed.
 * Decoding the request's own session cookie (`getToken({ req })`) is wrong on the first request after the access token expires: qwik-auth's `onRequest` refreshes it, but the new JWT only goes out on the response's `Set-Cookie`, so the request still carries the old one with the dead access token - every Cloudflare call 401s until the browser sends the new cookie on the next load.
 * The cookie decode stays only as a fallback for a request the auth plugin didn't run the callback for (no session cookie at all, where it also returns `null`).
 */
export async function readSessionToken(request: RequestEventBase['request'], platform: RequestEventBase['platform'], url: RequestEventBase['url'], sharedMap: RequestEventBase['sharedMap']): Promise<JWT | null> {
	if (sharedMap.has(SESSION_JWT_KEY)) return (sharedMap.get(SESSION_JWT_KEY) as JWT | null | undefined) ?? null;

	return getToken({
		req: request,
		secret: platform.env.AUTH_SECRET,
		secureCookie: url.protocol === 'https:',
	});
}

/**
 * `routeAction$` handlers and `server$` functions get a request event without `resolveValue` - unlike loaders
 * (see `useAuthToken` in `~/routes/layout.tsx`), there's no way to read another loader's resolved value from
 * inside them. This re-derives the same JWT read directly for handlers that need the Cloudflare access token
 * (e.g. `useUpdatePolicy` in `~/routes/[accountId]/index.tsx`, `fetchChunkPage` in the list detail route).
 */
export async function getCloudflareAccessToken(request: RequestEventBase['request'], platform: RequestEventBase['platform'], url: RequestEventBase['url'], sharedMap: RequestEventBase['sharedMap']) {
	const token = await readSessionToken(request, platform, url, sharedMap);

	return token?.cloudflare?.accessToken;
}

export function accountToCloudflareTokenSet(account: Account) {
	if (!account.access_token || !account.expires_at) return undefined;

	return {
		accessToken: account.access_token,
		refreshToken: account.refresh_token ?? undefined,
		expiresAt: account.expires_at,
	} as CloudflareTokenSet;
}

/**
 * Refreshes an expired (or about-to-expire) Cloudflare access token.
 * Returns `undefined` (rather than throwing) when refresh isn't possible, so the caller
 * can fall back to dropping the token and forcing a fresh sign-in.
 */
export async function refreshCloudflareTokenSet(current: CloudflareTokenSet, clientId: string, clientSecret: string) {
	if (!current.refreshToken) return undefined;

	const response = await fetch(TOKEN_ENDPOINT, {
		method: 'POST',
		headers: { 'content-type': 'application/x-www-form-urlencoded' },
		body: new URLSearchParams({
			grant_type: 'refresh_token',
			refresh_token: current.refreshToken,
			client_id: clientId,
			client_secret: clientSecret,
		}),
	});

	if (!response.ok) return undefined;

	const tokens = await response.json<{ access_token: string; refresh_token?: string; expires_in: number }>();

	return {
		accessToken: tokens.access_token,
		refreshToken: tokens.refresh_token ?? current.refreshToken,
		expiresAt: Math.floor(Date.now() / 1000) + tokens.expires_in,
	} as CloudflareTokenSet;
}
