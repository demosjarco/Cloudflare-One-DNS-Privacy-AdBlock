import { getToken } from '@auth/core/jwt';
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

/**
 * Reads the Cloudflare access token out of the (encrypted) session JWT for use in a
 * server-only context (routeLoader$/routeAction$/onRequest). Never expose this value to the client.
 */
export async function getCloudflareAccessToken(event: RequestEventBase) {
	const token = await getToken({
		req: event.request,
		secret: event.platform.env.AUTH_SECRET,
		secureCookie: event.url.protocol === 'https:',
	});

	return token?.cloudflare?.accessToken;
}
