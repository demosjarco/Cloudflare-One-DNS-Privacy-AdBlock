import { component$, type Component } from '@builder.io/qwik';
import { LuPower, LuPowerOff, LuTrash2 } from '@qwikest/icons/lucide';

// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore this gets generated automatically later in the build process
import * as m from '~/paraglide/messages';

export type PolicyState = 'enabled' | 'disabled' | 'deleted';

/*
 * Kumo's `Radio` React component can't be imported here for the same reason documented in
 * `theme-toggle.tsx` (it unconditionally pulls in `react`/`react/jsx-runtime`, and this app only ever
 * consumes Kumo's CSS - see `src/global.css` and `helpers/verifyNoReactInDist.ts`).
 * These class strings are Kumo's `Radio.Group appearance="segmented"` (`@cloudflare/kumo@2.17.0`,
 * `node_modules/@cloudflare/kumo/dist/chunks/radio-*.js`): the `items` wrapper for GROUP and the segmented
 * `item-label` for SEGMENT. Each segment here is a submit `<button>` rather than a radio (picking one posts
 * the form immediately), so Base UI's `has-data-checked:`/`has-data-disabled:` become `aria-pressed:`/
 * `disabled:` on the button itself.
 * Kumo's segmented look only has the one contrast fill, so each pressed state gets its own tint instead:
 * - Enabled: the same blue as the "on" track of the category switches below (`category-toggles.tsx` TRACK),
 *   so an enabled policy and its enabled categories read as one colour.
 * - Disabled: the same grays as the switches' "off" track (`neutral-200` light / `neutral-700` dark).
 * - Deleted: `Button variant="destructive"`'s white-on-danger fill (`dist/chunks/button-*.js`) when pressed, and a
 *   danger-red icon when not, so it still reads as destructive at a glance. `not-aria-pressed:` (rather than a bare
 *   `text-kumo-danger`) out-specifies SEGMENT's `text-kumo-default` regardless of stylesheet order.
 */
const GROUP = 'inline-flex w-max flex-row flex-nowrap items-center self-start rounded-lg bg-kumo-control shadow-xs ring ring-kumo-line';
const SEGMENT = 'group relative z-0 -ml-px inline-flex h-8.5 shrink-0 cursor-pointer items-center border-r border-kumo-line/60 bg-transparent px-3 text-kumo-default select-none first:ml-0 first:rounded-l-lg first:pl-2.75 last:rounded-r-lg last:border-r-0 last:pr-2.75 disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-kumo-brand before:absolute before:-inset-y-px before:-right-px before:left-0 before:-z-10 first:before:-left-px first:before:rounded-l-[9px] last:before:rounded-r-[9px] not-disabled:not-aria-pressed:hover:before:bg-kumo-contrast/7';
const PRESSED_ENABLED = 'aria-pressed:text-white aria-pressed:before:bg-blue-500 dark:aria-pressed:before:bg-blue-600';
const PRESSED_DISABLED = 'aria-pressed:text-kumo-strong aria-pressed:before:bg-neutral-200 dark:aria-pressed:before:bg-neutral-700';
const PRESSED_DELETED = 'not-aria-pressed:text-kumo-danger aria-pressed:text-white aria-pressed:before:bg-kumo-danger';

export interface TriStateControlProps {
	current: PolicyState;
	/** Fades + disables the whole control while this card's `routeAction$` is running. */
	isRunning: boolean;
	/** True when no category is selected - the Enabled/Disabled segments would produce an empty `traffic` expression, so they're disabled until at least one category is checked. Deleting is still always allowed. */
	enableDisableBlocked: boolean;
	deleteConfirmMessage: string;
}

export const TriStateControl = component$<TriStateControlProps>(({ current, isRunning, enableDisableBlocked, deleteConfirmMessage }) => {
	// Icon-only segments (power on / power off / trash read the same in every locale); the translated label stays as the accessible name and hover tooltip.
	// Labels are resolved to plain strings up front - `onClick$` below closes over each `segment`, and a
	// paraglide message export is a function, which Qwik can't serialize into a QRL's captured scope.
	const segments: { value: PolicyState; label: string; Icon: Component<{ class?: string }>; pressedClass: string }[] = [
		{ value: 'enabled', label: m.gateway_state_enabled(), Icon: LuPower, pressedClass: PRESSED_ENABLED },
		{ value: 'disabled', label: m.gateway_state_disabled(), Icon: LuPowerOff, pressedClass: PRESSED_DISABLED },
		{ value: 'deleted', label: m.gateway_state_deleted(), Icon: LuTrash2, pressedClass: PRESSED_DELETED },
	];

	return (
		<div class={[GROUP, 'transition-opacity duration-150', isRunning && 'pointer-events-none opacity-60']} role="group">
			{segments.map(({ value, label, Icon, pressedClass }) => {
				const blocked = value !== 'deleted' && enableDisableBlocked;

				return (
					<button
						key={value}
						type="submit"
						name="state"
						value={value}
						aria-pressed={current === value}
						aria-label={label}
						title={label}
						disabled={isRunning || blocked}
						class={[SEGMENT, pressedClass]}
						onClick$={(event) => {
							if (value === 'deleted' && !confirm(deleteConfirmMessage)) event.preventDefault();
						}}>
						<Icon class="size-4" />
					</button>
				);
			})}
		</div>
	);
});
