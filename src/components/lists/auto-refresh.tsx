import { $, component$, isDev, useSignal, useVisibleTask$, type PropFunction, type ReadonlySignal } from '@builder.io/qwik';
import { openPeriodicRefresh, prunePeriodicRefresh, readPeriodicRefresh, setPeriodicRefresh, type PeriodicRefreshSupport } from '~/lib/periodic-refresh';
import { SWITCH_LABEL, SWITCH_THUMB, SWITCH_TRACK } from './shared';

// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore this gets generated automatically later in the build process
import * as m from '~/paraglide/messages';

/**
 * The browser's periodic-refresh registrations for one account, read straight from the service worker registration (`lib/periodic-refresh.ts`) - the switches render from `registered` and write through `setAutoRefresh$`, nothing in between.
 *
 * `allListIds` is the account's complete set of refreshable sources when the caller has it (the lists page): registrations for sources that no longer exist are dropped on every read. It's `undefined` - read the registrations, prune nothing - from the detail page, which only knows about one source, and from the lists page whenever its loader failed, since a failed read has nothing to say about which sources are gone.
 */
export function useAutoRefresh(accountId: string, allListIds: ReadonlySignal<string[] | undefined> | undefined) {
	const support = useSignal<PeriodicRefreshSupport>();
	const registered = useSignal<string[]>([]);

	// eslint-disable-next-line qwik/no-use-visible-task
	useVisibleTask$(
		async ({ track }) => {
			const liveIds = allListIds ? track(allListIds) : undefined;
			// No service worker on the dev server (qwik-city unregisters it), so `openPeriodicRefresh` would wait forever.
			if (isDev) return;

			try {
				const access = await openPeriodicRefresh();
				support.value = access.support;
				if (access.support !== 'on') return;
				registered.value = liveIds ? await prunePeriodicRefresh(access.manager, accountId, liveIds) : await readPeriodicRefresh(access.manager, accountId);
			} catch (err) {
				console.warn('Periodic background refresh is unavailable', err);
			}
		},
		{ strategy: 'document-idle' },
	);

	const setAutoRefresh$ = $(async (listId: string, on: boolean) => {
		const access = await openPeriodicRefresh();
		if (access.support !== 'on') return;

		await setPeriodicRefresh(access.manager, { accountId, listId }, on);
		const id = listId.toLowerCase();
		registered.value = on ? [...registered.value.filter((other) => other !== id), id] : registered.value.filter((other) => other !== id);
	});

	return { support, registered, setAutoRefresh$ };
}

/** What the lists UI says about background refresh in this browser - nothing while the check is still running. */
export function describeAutoRefreshSupport(support: PeriodicRefreshSupport | undefined): string | undefined {
	switch (support) {
		case 'on':
			return m.lists_background_refresh_on();
		case 'install':
			return m.lists_background_refresh_install();
		case 'unsupported':
			return m.lists_background_refresh_unsupported();
		case 'unavailable':
			return m.lists_background_refresh_unavailable();
		case undefined:
			return undefined;
	}
}

export interface AutoRefreshToggleProps {
	listId: string;
	checked: boolean;
	support: PeriodicRefreshSupport | undefined;
	label: string;
	onChange$: PropFunction<(listId: string, on: boolean) => Promise<void>>;
}

/**
 * The same switch as the DNS/HTTP policy toggles, flipping a periodic-refresh registration instead of a rule.
 *
 * Where the API isn't usable the switch stays clickable but never flips: the click gets a browser `alert` with the reason (install the app, unsupported browser, no active service worker - the one message shown while the check hasn't finished, which on the dev server is forever), since a dimmed control with a tooltip is easy to miss. `preventdefault:click` keeps the checkbox from toggling on its own in every case - the state is the registration, so it only moves once the register/unregister call has landed.
 */
export const AutoRefreshToggle = component$<AutoRefreshToggleProps>(({ listId, checked, support, label, onChange$ }) => {
	const busy = useSignal(false);
	const usable = support === 'on';
	const reason = describeAutoRefreshSupport(support) ?? m.lists_background_refresh_unavailable();

	return (
		<label class={[SWITCH_LABEL, (busy.value || !usable) && 'opacity-60', busy.value && 'pointer-events-none']} title={usable ? undefined : reason} onClick$={(event) => event.stopPropagation()}>
			<input
				type="checkbox"
				checked={checked}
				disabled={busy.value}
				aria-disabled={!usable}
				class="peer sr-only"
				preventdefault:click
				onClick$={async (_, element) => {
					if (!usable) {
						alert(reason);
						return;
					}

					const next = !checked;
					busy.value = true;
					try {
						await onChange$(listId, next);
						element.checked = next;
					} catch (err) {
						console.warn('Could not change the periodic background refresh registration', err);
						element.checked = checked;
					} finally {
						busy.value = false;
					}
				}}
			/>
			<span class={SWITCH_TRACK} />
			<span class={SWITCH_THUMB} />
			<span class="sr-only">{label}</span>
		</label>
	);
});
