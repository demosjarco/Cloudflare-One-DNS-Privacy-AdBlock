import { APIError } from 'cloudflare';
import { BaseCategories, type Category } from 'cloudflare/resources/zero-trust/gateway/categories';
import { createClient } from 'cloudflare/tree-shakable';

/** The three content categories this app's managed policies expose as toggles. Matched by name (case-insensitive) against whatever the account's live `categories.list()` actually returns - never hardcoded IDs, since Cloudflare's own docs table for this has been observed to lag behind categories the dashboard already offers (e.g. "Trackers/Analytics"). */
export const MANAGED_CATEGORY_NAMES = ['Ads', 'Trackers/Analytics', 'Deceptive Ads'] as const;

export interface ManagedCategory {
	name: (typeof MANAGED_CATEGORY_NAMES)[number];
	id: number;
	/** Straight from the API response - never a localized/hardcoded string, so it stays correct even when the docs page doesn't. */
	description: string | undefined;
}

function flattenCategories(categories: Category[]) {
	const flat: { name: string; id: number; description: string | undefined }[] = [];

	for (const category of categories) {
		if (typeof category.id === 'number' && category.name) flat.push({ name: category.name, id: category.id, description: category.description });
		for (const subcategory of category.subcategories ?? []) {
			if (typeof subcategory.id === 'number' && subcategory.name) flat.push({ name: subcategory.name, id: subcategory.id, description: subcategory.description });
		}
	}

	return flat;
}

/**
 * Resolves {@link MANAGED_CATEGORY_NAMES} against the account's live category list. A name that doesn't resolve (renamed/removed on Cloudflare's side) is silently omitted rather than crashing the page - the corresponding toggle just doesn't render.
 *
 * @link https://developers.cloudflare.com/api/resources/zero_trust/subresources/gateway/subresources/categories/methods/list/
 */
export async function resolveManagedCategories(apiToken: string, accountId: string, signal: AbortSignal): Promise<{ categories: ManagedCategory[]; failed: boolean }> {
	try {
		const client = createClient({ apiToken, resources: [BaseCategories] });
		const categories = await Array.fromAsync(client.zeroTrust.gateway.categories.list({ account_id: accountId }, { signal }));
		const flat = flattenCategories(categories);

		const managed = MANAGED_CATEGORY_NAMES.map((name) => {
			const match = flat.find((candidate) => candidate.name.trim().toLowerCase() === name.toLowerCase());
			return match ? ({ name, id: match.id, description: match.description } satisfies ManagedCategory) : undefined;
		}).filter((category) => category !== undefined);

		return { categories: managed, failed: false };
	} catch (err) {
		if (err instanceof APIError) return { categories: [], failed: true };
		throw err;
	}
}
