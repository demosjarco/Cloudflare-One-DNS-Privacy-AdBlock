import { QwikAuth$ } from '@auth/qwik';
import Cloudflare from '~/lib/auth/cloudflare-provider';
import { accountToCloudflareTokenSet, refreshCloudflareTokenSet } from '~/lib/auth/cloudflare-token';

export const { onRequest, useSession, useSignIn, useSignOut } = QwikAuth$(({ platform }) => ({
	providers: [
		Cloudflare({
			clientId: platform.env.CF_OAUTH_ID,
			clientSecret: platform.env.CF_OAUTH_SECRET,
		}),
	],
	callbacks: {
		async jwt({ token, account }) {
			// Initial sign-in: stash the token set issued for the Zero Trust API calls this app makes on the user's behalf.
			if (account?.provider === 'cloudflare') {
				token.cloudflare = accountToCloudflareTokenSet(account);
				return token;
			}

			// Subsequent requests: refresh proactively once we're within 60s of expiry.
			if (token.cloudflare && token.cloudflare.expiresAt - 60 < Math.floor(Date.now() / 1000)) {
				const refreshed = await refreshCloudflareTokenSet(token.cloudflare, platform.env.CF_OAUTH_ID, platform.env.CF_OAUTH_SECRET);
				// Refresh failed (e.g. revoked/expired refresh token) - drop the dead token set rather than keep serving a stale one.
				token.cloudflare = refreshed;
			}

			return token;
		},
	},
	// debug: true,
	logger: {
		// Only debug log if not production
		// debug: console.debug,
		// Keep the following to use nice console log separation
		warn: console.warn,
		error: console.error,
	},
	pages: {
		signIn: '/login',
		error: '/login/error',
	},
	secret: platform.env.AUTH_SECRET,
	session: {
		strategy: 'jwt',
	},
	trustHost: true,
}));
