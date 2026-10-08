import { APIError } from 'cloudflare';
import { BaseRules, type GatewayRule } from 'cloudflare/resources/zero-trust/gateway/rules';
import { createClient } from 'cloudflare/tree-shakable';
import { buildTraffic, parseTraffic, type PolicyKind } from './policy-expression';

/** Canonical (lowercase) rule names this app manages. Lookups match existing rules against these case-insensitively - Cloudflare itself doesn't enforce name casing. */
export const MANAGED_RULE_NAMES: Record<PolicyKind, string> = {
	dns: 'cfodpa_dns',
	http: 'cfodpa_http',
};

function filterFor(kind: PolicyKind) {
	return kind === 'dns' ? 'dns' : 'http';
}

export interface ManagedRuleLookup {
	rule: GatewayRule | null;
	/** True when more than one rule matched the managed name + filter - the caller must not silently pick one (surface via `alert()` per the plan). */
	multipleMatches: boolean;
	failed: boolean;
}

/**
 * @link https://developers.cloudflare.com/api/resources/zero_trust/subresources/gateway/subresources/rules/methods/list/
 */
export async function findManagedRule(apiToken: string, accountId: string, kind: PolicyKind, signal: AbortSignal): Promise<ManagedRuleLookup> {
	try {
		const client = createClient({ apiToken, resources: [BaseRules] });
		const allRules = await Array.fromAsync(client.zeroTrust.gateway.rules.list({ account_id: accountId }, { signal }));

		const targetName = MANAGED_RULE_NAMES[kind].toLowerCase();
		const matches = allRules.filter((rule) => rule.name?.trim().toLowerCase() === targetName && rule.filters.includes(filterFor(kind)));

		return { rule: matches[0] ?? null, multipleMatches: matches.length > 1, failed: false };
	} catch (err) {
		if (err instanceof APIError) return { rule: null, multipleMatches: false, failed: true };
		throw err;
	}
}

/**
 * Creates this app's managed rule for the first time (tri-state `deleted -> enabled/disabled`).
 *
 * Precedence is the lowest value no existing rule on the account uses (Cloudflare enforces uniqueness across *all* Gateway rules regardless of filter - observed live: a second rule at `0` is rejected with error 2011 "A rule with this precedence already exists"). Starting the search at 0 keeps the blocklist ahead of broader `allow` rules; it's a one-time choice at creation, and every later update carries the rule's actual `precedence` through unchanged (see {@link updateManagedRuleFull}), so a manual reorder in the dashboard afterwards sticks.
 *
 * @link https://developers.cloudflare.com/api/resources/zero_trust/subresources/gateway/subresources/rules/methods/create/
 */
export async function createManagedRule(apiToken: string, accountId: string, kind: PolicyKind, params: { enabled: boolean; traffic: string }, signal: AbortSignal): Promise<GatewayRule> {
	const client = createClient({ apiToken, resources: [BaseRules] });

	const taken = new Set<number>();
	for await (const rule of client.zeroTrust.gateway.rules.list({ account_id: accountId }, { signal })) {
		if (typeof rule.precedence === 'number') taken.add(rule.precedence);
	}
	let precedence = 0;
	for (; taken.has(precedence); precedence++);

	return client.zeroTrust.gateway.rules.create(
		{
			account_id: accountId,
			name: MANAGED_RULE_NAMES[kind],
			action: 'block',
			filters: [filterFor(kind)],
			enabled: params.enabled,
			precedence,
			traffic: params.traffic,
		},
		{ signal },
	);
}

/**
 * Full PUT covering every field `RuleUpdateParams` accepts - the Gateway rules API replaces the whole rule on update, so omitting a field would silently wipe it. `existingRule` should come straight from {@link findManagedRule} (same request) so nothing drifts between read and write. `precedence` is always `existingRule.precedence`, never recomputed - see the module doc on {@link createManagedRule}.
 *
 * @link https://developers.cloudflare.com/api/resources/zero_trust/subresources/gateway/subresources/rules/methods/update/
 */
export async function updateManagedRuleFull(apiToken: string, accountId: string, existingRule: GatewayRule, patch: { enabled?: boolean; traffic?: string }, signal: AbortSignal): Promise<GatewayRule> {
	const client = createClient({ apiToken, resources: [BaseRules] });
	if (!existingRule.id) throw new Error('existingRule is missing its id');

	return client.zeroTrust.gateway.rules.update(
		existingRule.id,
		{
			account_id: accountId,
			action: existingRule.action,
			name: existingRule.name,
			description: existingRule.description,
			device_posture: existingRule.device_posture,
			expiration: existingRule.expiration,
			filters: existingRule.filters,
			identity: existingRule.identity,
			precedence: existingRule.precedence,
			rule_settings: existingRule.rule_settings,
			schedule: existingRule.schedule,
			enabled: patch.enabled ?? existingRule.enabled,
			traffic: patch.traffic ?? existingRule.traffic,
		},
		{ signal },
	);
}

/**
 * @link https://developers.cloudflare.com/api/resources/zero_trust/subresources/gateway/subresources/rules/methods/delete/
 */
export async function deleteManagedRule(apiToken: string, accountId: string, ruleId: string, signal: AbortSignal): Promise<void> {
	const client = createClient({ apiToken, resources: [BaseRules] });
	await client.zeroTrust.gateway.rules.delete(ruleId, { account_id: accountId }, { signal });
}

export type ListMembershipResult = { ok: true; lookup: ManagedRuleLookup } | { ok: false; error: 'lookup-failed' | 'multiple-matches' };

/**
 * Adds or removes one synced list's `any(<domains>[*] in $<id>)` clause from the managed rule of the given kind, carrying every other clause (categories, other lists, DNS locations) through untouched.
 *
 * - No managed rule yet and `included`: the rule is created (enabled) with just this list - the policies page is where categories get added afterwards.
 * - Removing the last clause leaves nothing for Cloudflare to match on (an empty `traffic` is rejected), so the rule is deleted instead - the same end state as the tri-state control's "Deleted".
 * - Already in the requested state: no write at all.
 */
export async function setManagedRuleListMembership(apiToken: string, accountId: string, kind: PolicyKind, listId: string, included: boolean, signal: AbortSignal): Promise<ListMembershipResult> {
	const lookup = await findManagedRule(apiToken, accountId, kind, signal);
	if (lookup.failed) return { ok: false, error: 'lookup-failed' };
	if (lookup.multipleMatches) return { ok: false, error: 'multiple-matches' };

	const selection = lookup.rule ? parseTraffic(kind, lookup.rule.traffic) : { categoryIds: [], listIds: [], locationIds: [] };
	const target = listId.toLowerCase();
	const alreadyIncluded = selection.listIds.some((id) => id.toLowerCase() === target);
	if (alreadyIncluded === included) return { ok: true, lookup };

	selection.listIds = included ? [...selection.listIds, listId] : selection.listIds.filter((id) => id.toLowerCase() !== target);
	const traffic = buildTraffic(kind, selection);

	if (!traffic) {
		if (lookup.rule?.id) await deleteManagedRule(apiToken, accountId, lookup.rule.id, signal);
		return { ok: true, lookup: { rule: null, multipleMatches: false, failed: false } };
	}

	const rule = lookup.rule ? await updateManagedRuleFull(apiToken, accountId, lookup.rule, { traffic }, signal) : await createManagedRule(apiToken, accountId, kind, { enabled: true, traffic }, signal);
	return { ok: true, lookup: { rule, multipleMatches: false, failed: false } };
}

/** Case-insensitive "is this list referenced by this rule" read, for the lists table's DNS/HTTP toggles. */
export function ruleIncludesList(lookup: ManagedRuleLookup, kind: PolicyKind, listId: string) {
	if (!lookup.rule) return false;
	const target = listId.toLowerCase();
	return parseTraffic(kind, lookup.rule.traffic).listIds.some((id) => id.toLowerCase() === target);
}
