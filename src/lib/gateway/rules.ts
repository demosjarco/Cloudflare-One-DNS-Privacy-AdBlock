import { APIError } from 'cloudflare';
import { BaseRules, type GatewayRule } from 'cloudflare/resources/zero-trust/gateway/rules';
import { createClient } from 'cloudflare/tree-shakable';
import type { PolicyKind } from './policy-expression';

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
 * `precedence: 0` (highest precedence, evaluated first) so this blocklist can't be shadowed by a broader existing `allow` rule - a one-time choice made only at creation. Every later update carries the rule's actual `precedence` through unchanged (see {@link updateManagedRuleFull}), so a manual reorder in the dashboard afterwards sticks.
 *
 * @link https://developers.cloudflare.com/api/resources/zero_trust/subresources/gateway/subresources/rules/methods/create/
 */
export async function createManagedRule(apiToken: string, accountId: string, kind: PolicyKind, params: { enabled: boolean; traffic: string }, signal: AbortSignal): Promise<GatewayRule> {
	const client = createClient({ apiToken, resources: [BaseRules] });
	return client.zeroTrust.gateway.rules.create(
		{
			account_id: accountId,
			name: MANAGED_RULE_NAMES[kind],
			action: 'block',
			filters: [filterFor(kind)],
			enabled: params.enabled,
			precedence: 0,
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
