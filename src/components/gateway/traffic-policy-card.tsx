import { component$, useSignal } from '@builder.io/qwik';
import { Form, type ActionStore } from '@builder.io/qwik-city';
import type { ManagedCategory } from '~/lib/gateway/categories';
import type { Location } from '~/lib/gateway/locations';
import type { PolicyKind } from '~/lib/gateway/policy-expression';
import { CategoryToggles } from './category-toggles';
import { LocationDrawer } from './location-drawer';
import { LocationScope } from './location-scope';
import { TriStateControl, type PolicyState } from './tri-state-control';

// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore this gets generated automatically later in the build process
import * as m from '~/paraglide/messages';

/** Hand-derived from Kumo's `LayerCard` surface classes (`@cloudflare/kumo@2.13.2`, `node_modules/@cloudflare/kumo/dist/chunks/layer-card-*.js`) - see `theme-toggle.tsx` for why the real component can't be imported. */
const CARD_SURFACE = 'overflow-hidden rounded-lg bg-kumo-base shadow-xs ring ring-kumo-line p-4 flex flex-col gap-4';

export interface TrafficPolicyCardProps {
	kind: PolicyKind;
	accountId: string;
	title: string;
	state: PolicyState;
	multipleMatches: boolean;
	categories: ManagedCategory[];
	categoriesFailed: boolean;
	initialCategoryIds: number[];
	locations?: Location[];
	locationsFailed?: boolean;
	initialLocationScope?: 'all' | 'selected';
	initialLocationIds?: string[];
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	action: ActionStore<any, any>;
}

export const TrafficPolicyCard = component$<TrafficPolicyCardProps>(({ kind, accountId, title, state, multipleMatches, categories, categoriesFailed, initialCategoryIds, locations, locationsFailed, initialLocationScope, initialLocationIds, action }) => {
	const formRef = useSignal<HTMLFormElement>();
	const checkedCount = useSignal(initialCategoryIds.length);
	// Only fades/disables while a mutation is in flight - a disabled `<input>` is excluded from `FormData`
	// entirely, so gating this on `state === 'deleted'` would silently drop the default category selection
	// (see `index.tsx`) the moment "Enabled" is clicked from a fresh, never-created policy.
	const disabled = action.isRunning;

	return (
		<Form ref={formRef} action={action} class={CARD_SURFACE}>
			<input type="hidden" name="kind" value={kind} />
			<input type="hidden" name="currentState" value={state === 'deleted' ? 'disabled' : state} />

			<header class="flex flex-wrap items-center justify-between gap-3">
				<h2 class="text-kumo-strong text-lg font-semibold">{title}</h2>
				<TriStateControl current={state} isRunning={action.isRunning} enableDisableBlocked={checkedCount.value === 0} deleteConfirmMessage={m.gateway_state_deleted_confirm()} />
			</header>

			{multipleMatches ? <p class="text-kumo-danger text-sm">{kind === 'dns' ? m.gateway_policy_multiple_matches_dns() : m.gateway_policy_multiple_matches_http()}</p> : null}

			{categoriesFailed ? (
				<p class="text-kumo-danger text-sm">{m.gateway_categories_load_error()}</p>
			) : categories.length === 0 ? (
				<p class="text-kumo-subtle text-sm">{m.gateway_categories_unavailable()}</p>
			) : (
				<CategoryToggles
					categories={categories}
					checkedIds={initialCategoryIds}
					disabled={disabled}
					onChange$={() => {
						checkedCount.value = formRef.value?.querySelectorAll('input[name="categoryIds[]"]:checked').length ?? 0;
						formRef.value?.requestSubmit();
					}}
				/>
			)}

			{kind === 'dns' ? (
				locationsFailed ? (
					<p class="text-kumo-danger text-sm">{m.gateway_locations_load_error()}</p>
				) : (
					<>
						<LocationScope locations={locations ?? []} initialScope={initialLocationScope ?? 'all'} initialSelectedIds={initialLocationIds ?? []} disabled={disabled} onChange$={() => formRef.value?.requestSubmit()} />
						<LocationDrawer accountId={accountId} locations={locations ?? []} />
					</>
				)
			) : null}
		</Form>
	);
});
