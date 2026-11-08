import { component$, useSignal, type PropFunction } from '@builder.io/qwik';
import { useLocation } from '@builder.io/qwik-city';
import { LuExternalLink } from '@qwikest/icons/lucide';
import type { Location } from '~/lib/gateway/locations';

// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore this gets generated automatically later in the build process
import * as m from '~/paraglide/messages';

/*
 * Real native `<input type="radio">`/`<input type="checkbox">` elements throughout, so the location
 * scope/selection participates in native form submission with no extra JS state mirroring - see
 * `category-toggles.tsx` for why Kumo's own React components aren't imported here.
 * - Scope: Kumo's `Radio.Group appearance="segmented"` (`@cloudflare/kumo@2.17.0`,
 *   `node_modules/@cloudflare/kumo/dist/chunks/radio-*.js`), with the radio visually hidden inside each
 *   segment's `<label>` and Base UI's `has-data-checked:`/`has-data-disabled:` swapped for the native
 *   `has-checked:`/`has-disabled:`.
 * - Location picks: Kumo's `Checkbox` classes (`@cloudflare/kumo@2.13.2`,
 *   `node_modules/@cloudflare/kumo/dist/chunks/checkbox-*.js`).
 */
const SEGMENTED_GROUP = 'inline-flex w-max flex-row flex-nowrap items-center self-start rounded-lg bg-kumo-control shadow-xs ring ring-kumo-line';
const SEGMENT = 'group relative z-0 -ml-px inline-flex h-8.5 shrink-0 cursor-pointer items-center border-r border-kumo-line/60 bg-transparent px-3 text-sm font-medium whitespace-nowrap text-kumo-default select-none first:ml-0 first:rounded-l-lg first:pl-2.75 last:rounded-r-lg last:border-r-0 last:pr-2.75 has-checked:text-kumo-inverse has-disabled:cursor-not-allowed has-disabled:opacity-50 has-focus-visible:outline-2 has-focus-visible:outline-offset-2 has-focus-visible:outline-kumo-brand before:absolute before:-inset-y-px before:-right-px before:left-0 before:-z-10 first:before:-left-px first:before:rounded-l-[9px] last:before:rounded-r-[9px] hover:not-has-disabled:not-has-checked:before:bg-kumo-contrast/7 has-checked:before:bg-kumo-contrast';
const CHECKBOX = 'peer relative mt-0.5 size-4 shrink-0 cursor-pointer appearance-none rounded-sm border-0 bg-kumo-base ring ring-kumo-hairline checked:bg-kumo-contrast checked:ring-kumo-contrast focus-visible:ring-2 focus-visible:ring-kumo-brand disabled:cursor-not-allowed disabled:opacity-50';

export interface LocationScopeProps {
	locations: Location[];
	initialScope: 'all' | 'selected';
	initialSelectedIds: string[];
	disabled: boolean;
	onChange$: PropFunction<() => void>;
}

export const LocationScope = component$<LocationScopeProps>(({ locations, initialScope, initialSelectedIds, disabled, onChange$ }) => {
	const location = useLocation();
	const scope = useSignal<'all' | 'selected'>(initialScope);
	const selected = useSignal(new Set(initialSelectedIds));

	return (
		<fieldset class="flex flex-col gap-3">
			<legend class="text-kumo-default mb-1 text-base font-medium">{m.gateway_locations_heading()}</legend>

			<div class={SEGMENTED_GROUP}>
				<label class={SEGMENT}>
					<input
						type="radio"
						name="locationScope"
						value="all"
						checked={scope.value === 'all'}
						disabled={disabled}
						class="sr-only"
						onChange$={() => {
							scope.value = 'all';
							void onChange$();
						}}
					/>
					<span>{m.gateway_locations_all()}</span>
				</label>

				<label class={SEGMENT}>
					<input
						type="radio"
						name="locationScope"
						value="selected"
						checked={scope.value === 'selected'}
						disabled={disabled || locations.length === 0}
						class="sr-only"
						onChange$={() => {
							scope.value = 'selected';
							void onChange$();
						}}
					/>
					<span>{m.gateway_locations_select()}</span>
				</label>
			</div>

			{locations.length === 0 ? (
				<p class="text-kumo-subtle text-sm">
					{m.gateway_locations_none_configured()} {/* The dashboard's location list (Traffic controls > Resolver endpoints), where "Add a location" lives - Cloudflare's docs give the nav path but no direct "add" URL, so this lands one click short of the form. Same `/one/networks/resolvers-proxies` prefix as the links in `locations.ts`. */}
					<a href={`https://dash.cloudflare.com/${location.params['accountId']}/one/networks/resolvers-proxies`} target="_blank" rel="noreferrer" class="text-kumo-link inline-flex items-center gap-1 underline">
						{m.gateway_locations_add_link()}
						<LuExternalLink class="size-3.5 shrink-0" />
					</a>
				</p>
			) : (
				scope.value === 'selected' && (
					<div class="flex max-h-48 flex-col gap-2 overflow-y-auto">
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
