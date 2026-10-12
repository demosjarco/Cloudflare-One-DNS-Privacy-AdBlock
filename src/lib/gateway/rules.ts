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
	return (await findManagedRules(apiToken, accountId, signal))[kind];
}

function matchManagedRule(allRules: GatewayRule[], kind: PolicyKind): ManagedRuleLookup {
	const targetName = MANAGED_RULE_NAMES[kind].toLowerCase();
	const matches = allRules.filter((rule) => rule.name?.trim().toLowerCase() === targetName && rule.filters.includes(filterFor(kind)));
	return { rule: matches[0] ?? null, multipleMatches: matches.length > 1, failed: false };
}

/** Both managed rules from a single `rules.list()` read - the account's rules come back as one list anyway, so looking the two up separately just doubles the request. */
export async function findManagedRules(apiToken: string, accountId: string, signal: AbortSignal): Promise<Record<PolicyKind, ManagedRuleLookup>> {
	try {
		const client = createClient({ apiToken, resources: [BaseRules] });
		const allRules = await Array.fromAsync(client.zeroTrust.gateway.rules.list({ account_id: accountId }, { signal }));
		return { dns: matchManagedRule(allRules, 'dns'), http: matchManagedRule(allRules, 'http') };
	} catch (err) {
		if (err instanceof APIError) {
			const failed: ManagedRuleLookup = { rule: null, multipleMatches: false, failed: true };
			return { dns: failed, http: failed };
		}
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
 * Adds or removes a set of synced lists' `any(<domains>[*] in $<id>)` clauses from the managed rule of the given kind in one write, carrying every other clause (categories, other lists, DNS locations) through untouched. A set rather than one id because a chunked source is several Cloudflare lists that must flip together - see `ManagedListGroup` in `lists.ts`.
 *
 * - No managed rule yet and `included`: the rule is created (enabled) with just these lists - the policies page is where categories get added afterwards.
 * - Removing the last clause leaves nothing for Cloudflare to match on (an empty `traffic` is rejected), so the rule is deleted instead - the same end state as the tri-state control's "Deleted".
 * - Already in the requested state (every id present, or every id absent): no write at all. A partially-wired set is completed/cleared, which is how an interrupted sync heals on the next one.
 *
 * Untested: how long a `traffic` expression Cloudflare accepts. A hundred chunk clauses is ~6 KB; if the rules API rejects that, its error surfaces verbatim.
 */
export async function setManagedRuleListMembership(apiToken: string, accountId: string, kind: PolicyKind, listIds: string[], included: boolean, signal: AbortSignal): Promise<ListMembershipResult> {
	const lookup = await findManagedRule(apiToken, accountId, kind, signal);
	if (lookup.failed) return { ok: false, error: 'lookup-failed' };
	if (lookup.multipleMatches) return { ok: false, error: 'multiple-matches' };

	const selection = lookup.rule ? parseTraffic(kind, lookup.rule.traffic) : { categoryIds: [], securityCategoryIds: [], listIds: [], locationIds: [] };
	const present = new Set(selection.listIds.map((id) => id.toLowerCase()));
	const targets = new Set(listIds.map((id) => id.toLowerCase()));

	if (included) {
		const missing = listIds.filter((id) => !present.has(id.toLowerCase()));
		if (missing.length === 0) return { ok: true, lookup };
		selection.listIds = [...selection.listIds, ...missing];
	} else {
		const remaining = selection.listIds.filter((id) => !targets.has(id.toLowerCase()));
		if (remaining.length === selection.listIds.length) return { ok: true, lookup };
		selection.listIds = remaining;
	}
	const traffic = buildTraffic(kind, selection);

	if (!traffic) {
		if (lookup.rule?.id) await deleteManagedRule(apiToken, accountId, lookup.rule.id, signal);
		return { ok: true, lookup: { rule: null, multipleMatches: false, failed: false } };
	}

	const rule = lookup.rule ? await updateManagedRuleFull(apiToken, accountId, lookup.rule, { traffic }, signal) : await createManagedRule(apiToken, accountId, kind, { enabled: true, traffic }, signal);
	return { ok: true, lookup: { rule, multipleMatches: false, failed: false } };
}

function referencedListIds(lookup: ManagedRuleLookup, kind: PolicyKind) {
	if (!lookup.rule) return new Set<string>();
	return new Set(parseTraffic(kind, lookup.rule.traffic).listIds.map((id) => id.toLowerCase()));
}

/** Case-insensitive "is every one of these lists referenced by this rule" read, for the DNS/HTTP toggles: a group whose chunks are only partly wired (an interrupted sync) renders off, and flipping it on wires the rest. */
export function ruleIncludesAllLists(lookup: ManagedRuleLookup, kind: PolicyKind, listIds: string[]) {
	if (listIds.length === 0) return false;
	const referenced = referencedListIds(lookup, kind);
	return listIds.every((id) => referenced.has(id.toLowerCase()));
}

/** Case-insensitive "is any of these lists referenced by this rule" read - the signal a sync uses to decide whether a group is meant to be in the rule at all. */
export function ruleIncludesAnyList(lookup: ManagedRuleLookup, kind: PolicyKind, listIds: string[]) {
	const referenced = referencedListIds(lookup, kind);
	return listIds.some((id) => referenced.has(id.toLowerCase()));
}
