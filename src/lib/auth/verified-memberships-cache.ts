import type { Cookie } from '@builder.io/qwik-city';
import * as zm from 'zod/mini';

/** SSR-only (httpOnly) cache of which of the signed-in user's Cloudflare accounts this session's OAuth token can actually reach. See the account-picker discussion this was built from: `memberships.read` lists every account the human belongs to, but the Zero Trust scope granted at consent only authorizes the one account picked in that flow - there's no claim identifying which one, so the only way to find out is to probe. */
export const VERIFIED_ACCOUNTS_COOKIE = 'zt_verified_accounts';

/**
 * @link https://developers.cloudflare.com/fundamentals/api/reference/limits/
 * Matches Cloudflare's own API rate-limit window (1,200 requests/5 min per user) - long enough that a warm cache skips re-probing on every navigation, short enough that a membership change (removed from an account, grant revoked) is never stale for more than one window.
 */
export const VERIFIED_ACCOUNTS_TTL_SECONDS = 300;

export interface VerifiedAccount {
	id: string;
	name: string;
}

const verifiedAccountSchema = zm.object({
	id: zm.string(),
	name: zm.string(),
});

const verifiedAccountsPayloadSchema = zm.object({
	// The JWT `sub` (Cloudflare user id) this cache was built for. A mismatch - re-login, a different user on a shared browser - invalidates the cookie immediately instead of leaking the previous session's accounts for the rest of the TTL.
	sub: zm.string(),
	accounts: zm.array(verifiedAccountSchema),
});

/** Returns `undefined` on a missing, malformed, tampered, or session-mismatched cookie - any of those must fall back to re-probing, never to trusting stale/foreign data. */
export function readVerifiedAccounts(cookie: Cookie, sub: string): VerifiedAccount[] | undefined {
	let payload: unknown;
	try {
		payload = cookie.get(VERIFIED_ACCOUNTS_COOKIE)?.json();
	} catch {
		return undefined;
	}
	if (payload === undefined) return undefined;

	const result = zm.safeParse(verifiedAccountsPayloadSchema, payload);
	if (!result.success || result.data.sub !== sub) return undefined;

	return result.data.accounts;
}

export function writeVerifiedAccounts(cookie: Cookie, sub: string, accounts: VerifiedAccount[], secure: boolean): void {
	cookie.set(
		VERIFIED_ACCOUNTS_COOKIE,
		{ sub, accounts },
		{
			httpOnly: true,
			secure,
			sameSite: 'lax',
			path: '/',
			maxAge: VERIFIED_ACCOUNTS_TTL_SECONDS,
		},
	);
}
