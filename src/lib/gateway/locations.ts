import { APIError } from 'cloudflare';
import { BaseLocations, type Location } from 'cloudflare/resources/zero-trust/gateway/locations';
import { createClient } from 'cloudflare/tree-shakable';

export type { Location };

/**
 * @link https://developers.cloudflare.com/api/resources/zero_trust/subresources/gateway/subresources/locations/methods/list/
 */
export async function listDnsLocations(apiToken: string, accountId: string, signal: AbortSignal): Promise<{ locations: Location[]; failed: boolean }> {
	try {
		const client = createClient({ apiToken, resources: [BaseLocations] });
		const locations = await Array.fromAsync(client.zeroTrust.gateway.locations.list({ account_id: accountId }, { signal }));
		return { locations, failed: false };
	} catch (err) {
		if (err instanceof APIError) return { locations: [], failed: true };
		throw err;
	}
}

/**
 * The DoH URL Gateway assigns per location - confirmed format from Cloudflare's own docs (`https://<doh_subdomain>.cloudflare-gateway.com/dns-query`).
 *
 * Deliberately no equivalent for DoT: the API's `Location` type has no DoT-hostname field (only per-endpoint `enabled` flags), so this app never fabricates one - the dashboard "Instructions" link is the authoritative source for it.
 *
 * @link https://developers.cloudflare.com/cloudflare-one/networks/resolvers-and-proxies/dns/locations/dns-resolver-ips/#dns-over-https-doh
 */
export function dohUrl(dohSubdomain: string) {
	return `https://${dohSubdomain}.cloudflare-gateway.com/dns-query`;
}

export function locationEditUrl(accountId: string, locationId: string) {
	return `https://dash.cloudflare.com/${accountId}/one/networks/resolvers-proxies/locations/${locationId}/edit-non-authed`;
}

export function locationInstructionsUrl(accountId: string, locationId: string) {
	return `https://dash.cloudflare.com/${accountId}/one/networks/resolvers-proxies/locations/${locationId}/instructions`;
}
