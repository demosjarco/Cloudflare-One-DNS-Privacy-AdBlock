import { component$, useSignal, type PropFunction } from '@builder.io/qwik';
import type { Location } from '~/lib/gateway/locations';

// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore this gets generated automatically later in the build process
import * as m from '~/paraglide/messages';

/*
 * Real native `<input type="radio">`/`<input type="checkbox">` elements throughout, styled with Kumo's
 * `Checkbox` classes (`@cloudflare/kumo@2.13.2`, `node_modules/@cloudflare/kumo/dist/chunks/checkbox-*.js`)
 * via Tailwind `peer-checked:` - see `category-toggles.tsx` for why Kumo's own React components aren't
 * imported here. Using real form controls means the location scope/selection participates in native form
 * submission with no extra JS state mirroring.
 */
const RADIO = 'peer relative size-4 shrink-0 cursor-pointer appearance-none rounded-full border-0 bg-kumo-base ring ring-kumo-hairline checked:ring-[5px] checked:ring-kumo-contrast focus-visible:ring-2 focus-visible:ring-kumo-brand disabled:cursor-not-allowed disabled:opacity-50';
const CHECKBOX = 'peer relative mt-0.5 size-4 shrink-0 cursor-pointer appearance-none rounded-sm border-0 bg-kumo-base ring ring-kumo-hairline checked:bg-kumo-contrast checked:ring-kumo-contrast focus-visible:ring-2 focus-visible:ring-kumo-brand disabled:cursor-not-allowed disabled:opacity-50';

export interface LocationScopeProps {
	locations: Location[];
	initialScope: 'all' | 'selected';
	initialSelectedIds: string[];
	disabled: boolean;
	onChange$: PropFunction<() => void>;
}

export const LocationScope = component$<LocationScopeProps>(({ locations, initialScope, initialSelectedIds, disabled, onChange$ }) => {
	const scope = useSignal<'all' | 'selected'>(initialScope);
	const selected = useSignal(new Set(initialSelectedIds));

	return (
		<fieldset class="flex flex-col gap-3">
			<legend class="text-kumo-default mb-1 text-base font-medium">{m.gateway_locations_heading()}</legend>

			<label class="flex items-center gap-2">
				<input
					type="radio"
					name="locationScope"
					value="all"
					checked={scope.value === 'all'}
					disabled={disabled}
					class={RADIO}
					onChange$={() => {
						scope.value = 'all';
						void onChange$();
					}}
				/>
				<span class="text-kumo-default text-base">{m.gateway_locations_all()}</span>
			</label>

			<label class="flex items-center gap-2">
				<input
					type="radio"
					name="locationScope"
					value="selected"
					checked={scope.value === 'selected'}
					disabled={disabled || locations.length === 0}
					class={RADIO}
					onChange$={() => {
						scope.value = 'selected';
						void onChange$();
					}}
				/>
				<span class="text-kumo-default text-base">{m.gateway_locations_select()}</span>
			</label>

			{locations.length === 0 ? (
				<p class="text-kumo-subtle pl-6 text-sm">{m.gateway_locations_none_configured()}</p>
			) : (
				scope.value === 'selected' && (
					<div class="flex max-h-48 flex-col gap-2 overflow-y-auto pl-6">
						{locations.map((location) => (
							<label key={location.id} class="flex items-start gap-2">
								<input
									type="checkbox"
									name="locationIds[]"
									value={location.id}
									checked={selected.value.has(location.id!)}
									disabled={disabled}
									class={CHECKBOX}
									onChange$={(_, target) => {
										const next = new Set(selected.value);
										if (target.checked) next.add(location.id!);
										else next.delete(location.id!);
										selected.value = next;
										void onChange$();
									}}
								/>
								<span class="text-kumo-default text-base">{location.name}</span>
							</label>
						))}
					</div>
				)
			)}
		</fieldset>
	);
});
