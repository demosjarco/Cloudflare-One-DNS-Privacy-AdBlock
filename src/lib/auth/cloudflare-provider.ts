import type { OAuthUserConfig } from '@auth/core/providers';
import type { OAuthConfig } from '@auth/core/providers/oauth';

/**
 * Confirmed live (2026-09-13): Cloudflare's OAuth server rejects this client requesting the `openid` scope outright (`invalid_scope: "The OAuth 2.0 Client is not allowed to request scope 'openid'"`), so no `id_token` is ever issued — this can't be an `oidc`-type provider. Identity/profile data has to come from the `/oauth2/userinfo` response using only the dashboard-granted scopes below.
 * @link https://developers.cloudflare.com/fundamentals/oauth/
 */
export interface CloudflareProfile extends Record<string, unknown> {
	sub: string;
}

/**
 * #### Callback URL
 * ```
 * https://<your-domain>/auth/callback/cloudflare
 * ```
 * @link https://developers.cloudflare.com/fundamentals/oauth/create-an-oauth-client/
 */
export default function Cloudflare({ clientId, clientSecret }: OAuthUserConfig<CloudflareProfile>): OAuthConfig<CloudflareProfile> {
	return {
		id: 'cloudflare',
		name: 'Cloudflare',
		type: 'oauth',
		issuer: 'https://dash.cloudflare.com',
		clientId,
		clientSecret,
		// Exactly the scopes configured on the "ZT Pihole" OAuth client in the dashboard - `openid` is not one of them.
		// `teams.write` (Zero Trust Gateway) is what Gateway lists live under - the account id itself is taken from the URL (see `routes/[accountId]`), not derived from any scope.
		// `memberships.read` (Account & Billing: Memberships Read) is kept for a future account-picker UI (`GET /memberships`) - note it returns every account the signed-in human belongs to, not just the one granted here, so it can't be used to infer the OAuth-selected account.
		authorization: { params: { scope: ['offline_access', 'teams.write', 'memberships.read', 'user-details.read'].join(' ') } },
		// A plain `oauth` provider (see above) doesn't fall back to the discovery document's `userinfo_endpoint` - it must be set explicitly or auth.js throws "No userinfo endpoint configured".
		// Setting one of token/userinfo manually opts out of auto-discovery for BOTH, so both must be set together or auth.js throws "authorization server metadata does not contain a valid token_endpoint".
		token: 'https://dash.cloudflare.com/oauth2/token',
		userinfo: 'https://dash.cloudflare.com/oauth2/userinfo',
		client: { token_endpoint_auth_method: 'client_secret_post' },
		// Cloudflare's authorization server (Hydra-based) rejects requests with no `state` param ("too weak"/missing) - `pkce` alone (the auth.js default) isn't enough here.
		checks: ['pkce', 'state'],
		// auth.js's default `account()` only keeps a fixed known-field allowlist (access_token/refresh_token/expires_at/scope/...) and silently drops anything else Cloudflare's token endpoint returns.
		// Pass everything through so we can see (and use) any extra fields, e.g. an account id tied to this grant.
		account: (tokens) => {
			return tokens;
		},
		profile: (profile: CloudflareProfile) => {
			return {
				id: profile.sub,
			};
		},
	};
}
