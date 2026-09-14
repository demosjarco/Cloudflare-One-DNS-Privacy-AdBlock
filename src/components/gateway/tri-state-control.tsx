import { component$ } from '@builder.io/qwik';

// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore this gets generated automatically later in the build process
import * as m from '~/paraglide/messages';

export type PolicyState = 'enabled' | 'disabled' | 'deleted';

/*
 * Kumo's `Button` React component can't be imported here for the same reason documented in
 * `theme-toggle.tsx` (it unconditionally pulls in `react`/`react/jsx-runtime`/`@phosphor-icons/react`,
 * and this app only ever consumes Kumo's CSS - see `src/global.css` and `helpers/verifyNoReactInDist.ts`).
 * These class strings are a hand-merge of `buttonVariants({ shape: "base", size: "sm", variant })` as of
 * `@cloudflare/kumo@2.13.2` (`node_modules/@cloudflare/kumo/dist/chunks/button-*.js`), with the conflicting
 * `shadow-xs`/`shadow-none` utility resolved the same way tailwind-merge would - last declaration in Kumo's
 * own `cn(...)` call order wins, so the ghost variant's `shadow-none` beats the shared base's `shadow-xs`.
 * Re-derive against `KUMO_BUTTON_VARIANTS` in `@cloudflare/kumo/components/button` if this ever needs to
 * track a newer Kumo version.
 */
const SEGMENT_BASE = 'group flex h-6.5 w-max shrink-0 items-center gap-1 rounded-md border-0 px-2 text-xs font-medium select-none focus:ring-kumo-focus/50 focus:outline-none focus-visible:ring-2 focus-visible:ring-kumo-brand disabled:cursor-not-allowed disabled:text-kumo-subtle';
const SEGMENT_ACTIVE = 'shadow-xs bg-kumo-base !text-kumo-default ring ring-kumo-line not-disabled:cursor-pointer not-disabled:hover:bg-kumo-tint disabled:bg-kumo-base/50 disabled:!text-kumo-default/70';
const SEGMENT_ACTIVE_DESTRUCTIVE = 'shadow-xs bg-kumo-base !text-kumo-danger ring ring-kumo-line not-disabled:cursor-pointer not-disabled:hover:!text-kumo-danger not-disabled:hover:ring-kumo-danger/30 disabled:bg-kumo-base/50 disabled:!text-kumo-danger/70';
const SEGMENT_INACTIVE = 'shadow-none bg-inherit text-kumo-default not-disabled:cursor-pointer not-disabled:hover:bg-kumo-tint';

export interface TriStateControlProps {
	current: PolicyState;
	/** Fades + disables the whole control while this card's `routeAction$` is running. */
	isRunning: boolean;
	/** True when no category is selected - the Enabled/Disabled segments would produce an empty `traffic` expression, so they're disabled until at least one category is checked. Deleting is still always allowed. */
	enableDisableBlocked: boolean;
	deleteConfirmMessage: string;
}

export const TriStateControl = component$<TriStateControlProps>(({ current, isRunning, enableDisableBlocked, deleteConfirmMessage }) => {
	// Labels are resolved to plain strings up front - `onClick$` below closes over each `segment`, and a
	// paraglide message export is a function, which Qwik can't serialize into a QRL's captured scope.
	const segments: { value: PolicyState; label: string; destructive?: boolean }[] = [
		{ value: 'enabled', label: m.gateway_state_enabled() },
		{ value: 'disabled', label: m.gateway_state_disabled() },
		{ value: 'deleted', label: m.gateway_state_deleted(), destructive: true },
	];

	return (
		<div class={['ring-kumo-line bg-kumo-tint inline-flex gap-0.5 rounded-lg p-0.5 ring transition-opacity duration-150', isRunning && 'pointer-events-none opacity-60']} role="group">
			{segments.map((segment) => {
				const isActive = current === segment.value;
				const blocked = segment.value !== 'deleted' && enableDisableBlocked;

				return (
					<button
						key={segment.value}
						type="submit"
						name="state"
						value={segment.value}
						disabled={isRunning || blocked}
						class={[SEGMENT_BASE, isActive ? (segment.destructive ? SEGMENT_ACTIVE_DESTRUCTIVE : SEGMENT_ACTIVE) : SEGMENT_INACTIVE]}
						onClick$={(event) => {
							if (segment.value === 'deleted' && !confirm(deleteConfirmMessage)) event.preventDefault();
						}}>
						{segment.label}
					</button>
				);
			})}
		</div>
	);
});
