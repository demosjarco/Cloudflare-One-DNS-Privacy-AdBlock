import { $, component$, useSignal } from '@builder.io/qwik';
import { LuMonitor, LuMoon, LuSun } from '@qwikest/icons/lucide';
import type * as zm from 'zod/mini';
import { useThemePreference } from '~/routes/layout';
import { THEME_COOKIE_NAME, type themePreferenceSchema } from './theme-shared';

// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore this gets generated automatically later in the build process
import * as m from '~/paraglide/messages';

/** Resolves `data-mode` from a preference, computing OS preference for "system". "system" is the default with no cookie at all (see `parseThemePreferenceFromCookieHeader`), so there's nothing worth persisting for it - delete the cookie instead of writing "system" into it. */
const applyThemePreference = $((preference: zm.infer<typeof themePreferenceSchema>) => {
	const root = document.documentElement;
	root.dataset['themePreference'] = preference;
	root.dataset['mode'] = preference === 'system' ? (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light') : preference;
	document.cookie = preference === 'system' ? `${THEME_COOKIE_NAME}=; path=/; max-age=0` : `${THEME_COOKIE_NAME}=${preference}; path=/; max-age=31536000; SameSite=Lax`;
});

const options = [
	{ value: 'light', icon: LuSun, label: m.sidebar_theme_light },
	{ value: 'dark', icon: LuMoon, label: m.sidebar_theme_dark },
	{ value: 'system', icon: LuMonitor, label: m.sidebar_theme_system },
] as const;

export const ThemeToggle = component$(() => {
	const preference = useSignal(useThemePreference().value);
	const currentIndex = Math.max(
		options.findIndex((option) => option.value === preference.value),
		0,
	);
	const current = options[currentIndex] ?? options[0];

	return (
		<button
			type="button"
			title={current.label()}
			aria-label={m.sidebar_theme_toggle_label()}
			/*
			 * Kumo's own `Button` React component (@cloudflare/kumo/components/button) can't be imported here - its module unconditionally imports `react`/`react/jsx-runtime`/`@phosphor-icons/react` at the top, which aren't installed (see src/global.css and helpers/verifyNoReactInDist.ts for why: this app only ever consumes Kumo's CSS). Its variant *data* (KUMO_BUTTON_VARIANTS) is plain, but merging it correctly needs a tailwind-merge-like resolver, and cnfast (the one Kumo itself uses) was deliberately left uninstalled here too - so this class string is a one-time hand-merge of `buttonVariants({ shape: "square", size: "sm", variant: "ghost" })` as of @cloudflare/kumo@2.13.2, resolving each conflicting Tailwind utility (h-6.5 vs size-6.5, px-2 vs p-0) the same way tailwind-merge would - last declaration in kumo's own `cn(...)` call order wins. The `disabled:*` variants from the source are dropped since this button is never disabled. Re-derive by hand against KUMO_BUTTON_VARIANTS in @cloudflare/kumo/components/button if this ever needs to track a newer Kumo version.
			 */
			class="group focus:ring-kumo-focus/50 focus-visible:ring-kumo-brand text-kumo-default hover:bg-kumo-tint flex size-6.5 w-max shrink-0 cursor-pointer items-center justify-center gap-1 rounded-md border-0 bg-inherit p-0 text-xs font-medium shadow-none select-none focus:outline-none focus-visible:ring-2"
			onClick$={() => {
				const next = options[(currentIndex + 1) % options.length] ?? options[0];
				preference.value = next.value;
				void applyThemePreference(next.value);
			}}>
			<current.icon class="size-3.5" />
		</button>
	);
});
