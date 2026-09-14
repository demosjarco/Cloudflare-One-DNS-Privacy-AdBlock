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
 * @link https://developers.cloudflare.com/cloudflare-one/networks/resolvers-and-proxies/dns/locations/dns-resolver-ips/#dns-over-https-doh
 */
export function dohUrl(dohSubdomain: string) {
	return `https://${dohSubdomain}.cloudflare-gateway.com/dns-query` as const;
}

/**
 * The DoT hostname Gateway assigns per location (port 853). The API's `Location` type has no DoT-hostname field, only `endpoints.dot.enabled`, so this derives it from `doh_subdomain` - Cloudflare's DoT docs show the same `<subdomain>.cloudflare-gateway.com` shape (e.g. `9y65g5srsm.cloudflare-gateway.com`), though they don't state outright that the two subdomains are identical. The dashboard "Instructions" link stays the authoritative source.
 *
 * @link https://developers.cloudflare.com/cloudflare-one/networks/resolvers-and-proxies/dns/dns-over-tls/
 */
export function dotHostname(dohSubdomain: string) {
	return `${dohSubdomain}.cloudflare-gateway.com` as const;
}

export function locationEditUrl(accountId: string, locationId: string) {
	return `https://dash.cloudflare.com/${accountId}/one/networks/resolvers-proxies/locations/${locationId}/edit-non-authed`;
}

export function locationInstructionsUrl(accountId: string, locationId: string) {
	return `https://dash.cloudflare.com/${accountId}/one/networks/resolvers-proxies/locations/${locationId}/instructions`;
}
