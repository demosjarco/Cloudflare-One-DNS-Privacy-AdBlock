import { APIError } from 'cloudflare';
import { BaseConfigurations } from 'cloudflare/resources/zero-trust/gateway/configurations/configurations';
import { createClient } from 'cloudflare/tree-shakable';

/** Cloudflare's code for "Account ID is invalid or has not been initialized" - what every Zero Trust endpoint answers (as a 401) for an account that never completed Zero Trust onboarding. */
const ZERO_TRUST_UNINITIALIZED_CODE = 1001;

export function isZeroTrustUninitialized(err: unknown): boolean {
	return err instanceof APIError && err.status === 401 && Array.isArray(err.errors) && err.errors.some((error) => error.code === ZERO_TRUST_UNINITIALIZED_CODE);
}

/** The Zero Trust dashboard for this account; for an account that hasn't been set up yet it opens the onboarding flow. */
export function zeroTrustSetupUrl(accountId: string) {
	return `https://dash.cloudflare.com/${accountId}/one`;
}

/** `false` only when Cloudflare says the account has no Zero Trust organization yet; any other failure is left for the page's own loaders to report. */
export async function isZeroTrustInitialized(apiToken: string, accountId: string, signal: AbortSignal): Promise<boolean> {
	try {
		const client = createClient({ apiToken, resources: [BaseConfigurations] });
		await client.zeroTrust.gateway.configurations.get({ account_id: accountId }, { signal });
		return true;
	} catch (err) {
		if (isZeroTrustUninitialized(err)) return false;
		if (err instanceof APIError) return true;
		throw err;
	}
}
