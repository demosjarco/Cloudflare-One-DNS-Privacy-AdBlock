import { component$, useSignal, type PropFunction } from '@builder.io/qwik';
import { LuInfo } from '@qwikest/icons/lucide';
import type { ManagedCategory } from '~/lib/gateway/categories';

// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore this gets generated automatically later in the build process
import * as m from '~/paraglide/messages';

export interface CategoryTogglesProps {
	categories: ManagedCategory[];
	checkedIds: number[];
	disabled: boolean;
	/** Fires after a checkbox toggle that leaves at least one category checked - the caller is expected to submit the form. Never fires for the change that would zero out the selection (that's blocked client-side, mirroring the server-side empty-expression guard). */
	onChange$: PropFunction<() => void>;
}

export const CategoryToggles = component$<CategoryTogglesProps>(({ categories, checkedIds, disabled, onChange$ }) => {
	const checked = useSignal(new Set(checkedIds));

	return (
		<fieldset class="flex flex-col gap-3">
			<legend class="text-kumo-default mb-1 text-base font-medium">{m.gateway_categories_heading()}</legend>
			{categories.map((category) => (
				<label key={category.id} class="flex cursor-pointer items-start gap-2">
					<span
						/*
						 * Kumo's `Switch` and `Tooltip` React components can't be imported here for the same reason documented in `theme-toggle.tsx` (they pull in `react`/`react/jsx-runtime`, not installed at runtime in this app). A real `<input type="checkbox">` drives the switch instead of Kumo's button-based implementation, so it participates in native `<form>` submission without any extra JS state mirroring - its visuals are recreated with Tailwind `peer-checked:`/`peer-disabled:` variants using the exact track/thumb classes from `@cloudflare/kumo@2.13.2`'s `Switch` (`node_modules/@cloudflare/kumo/dist/chunks/switch-*.js`, `size="base"`, `variant="default"`). The tooltip is a fixed-placement CSS-only hover/focus panel using Kumo's tooltip popup classes (`chunks/tooltip-*.js`) - it skips Floating UI's dynamic positioning, which is an acceptable simplification for a small static info icon that's always near the top of the card.
						 */
						class="relative inline-flex h-4.5 w-9 shrink-0 items-center">
						<input
							type="checkbox"
							name="categoryIds[]"
							value={category.id}
							checked={checked.value.has(category.id)}
							disabled={disabled}
							class="peer sr-only"
							onChange$={(_, target) => {
								const next = new Set(checked.value);
								if (target.checked) next.add(category.id);
								else next.delete(category.id);

								if (next.size === 0) {
									// Mirrors the server's empty-expression guard - never let the last category be unchecked client-side either.
									target.checked = true;
									alert(m.gateway_categories_empty_error());
									return;
								}

								checked.value = next;
								void onChange$();
							}}
						/>
						<span
							/**
							 * `peer-checked:` only matches a target that's a direct sibling of `.peer` (CSS `~` doesn't reach into
							 * descendants) - so this and the thumb span below must both be direct children of this wrapper (siblings
							 * of the `<input class="peer">` above), never nested inside one another, or `peer-checked:` silently never applies.
							 */
							class="peer-focus-visible:ring-kumo-brand pointer-events-none absolute inset-0 rounded-[5px] bg-neutral-200 ring ring-neutral-300 transition-colors duration-150 ease-out [corner-shape:squircle] peer-checked:bg-blue-500 peer-checked:ring-blue-600 peer-focus-visible:ring-2 peer-disabled:cursor-not-allowed peer-disabled:opacity-50 supports-[corner-shape:squircle]:rounded-[10px] dark:bg-neutral-700 dark:ring-neutral-600 dark:peer-checked:bg-blue-600 dark:peer-checked:ring-blue-500"
						/>
						<span class="bg-kumo-base dark:bg-neutral-850 pointer-events-none absolute top-0 bottom-0 left-0 w-4.5 rounded-[5px] shadow-[0_0_1px_0.5px_var(--color-kumo-shadow-edge),0_1px_2px_var(--color-kumo-shadow-drop)] transition-all duration-150 ease-out [corner-shape:squircle] peer-checked:left-4.5 supports-[corner-shape:squircle]:rounded-[10px] dark:peer-checked:bg-blue-300" />
					</span>
					<span class="text-kumo-default flex items-center gap-1 text-base">
						{category.name}
						{category.description ? (
							<span class="relative inline-flex">
								{/* `peer`/`peer-hover`/`peer-focus-visible` bind the tooltip directly to this icon's own box - unlike `group`/`group-hover`, which activates from anywhere inside a wrapping ancestor (here, that wrapper was sized to the icon already, but `peer` removes any dependency on wrapper sizing entirely so the hit-region can never drift to cover the label text next to it). */}
								<LuInfo class="peer text-kumo-subtle size-3.5 cursor-help" tabindex={0} />
								<span class="bg-kumo-base text-kumo-default outline-kumo-line pointer-events-none absolute bottom-full left-1/2 z-10 mb-2 w-56 -translate-x-1/2 rounded-md px-2.5 py-1.5 text-xs opacity-0 shadow-md outline transition-opacity duration-150 peer-hover:pointer-events-auto peer-hover:opacity-100 peer-focus-visible:pointer-events-auto peer-focus-visible:opacity-100">
									{category.description}{' '}
									<a href="https://developers.cloudflare.com/cloudflare-one/traffic-policies/domain-categories/#content-categories" target="_blank" rel="noreferrer" class="text-kumo-link underline">
										{m.gateway_categories_docs_link()}
									</a>
								</span>
							</span>
						) : null}
					</span>
				</label>
			))}
		</fieldset>
	);
});
