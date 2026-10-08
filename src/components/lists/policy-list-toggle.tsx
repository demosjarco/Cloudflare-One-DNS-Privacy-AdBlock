import { component$, isServer, useSignal, useTask$ } from '@builder.io/qwik';
import { Form, type ActionStore } from '@builder.io/qwik-city';
import type { PolicyKind } from '~/lib/gateway/policy-expression';
import { actionFailure } from './shared';

/** Visual classes lifted verbatim from `category-toggles.tsx` (Kumo `Switch`, `size="base"`) - see that file for why a real checkbox drives the switch instead of Kumo's React component. */
const TRACK = 'peer-focus-visible:ring-kumo-brand pointer-events-none absolute inset-0 rounded-[5px] bg-neutral-200 ring ring-neutral-300 transition-colors duration-150 ease-out [corner-shape:squircle] peer-checked:bg-blue-500 peer-checked:ring-blue-600 peer-focus-visible:ring-2 peer-disabled:cursor-not-allowed peer-disabled:opacity-50 supports-[corner-shape:squircle]:rounded-[10px] dark:bg-neutral-700 dark:ring-neutral-600 dark:peer-checked:bg-blue-600 dark:peer-checked:ring-blue-500';
const THUMB = 'bg-kumo-base dark:bg-neutral-850 pointer-events-none absolute top-0 bottom-0 left-0 w-4.5 rounded-[5px] shadow-[0_0_1px_0.5px_var(--color-kumo-shadow-edge),0_1px_2px_var(--color-kumo-shadow-drop)] transition-all duration-150 ease-out [corner-shape:squircle] peer-checked:left-4.5 supports-[corner-shape:squircle]:rounded-[10px] dark:peer-checked:bg-blue-300';

export interface PolicyListToggleProps {
	listId: string;
	kind: PolicyKind;
	included: boolean;
	label: string;
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	action: ActionStore<any, any>;
}

/**
 * One self-submitting form per switch: flipping it posts `useToggleListPolicy` (see `~/routes/[accountId]/layout.tsx`), which rewrites the managed rule's `traffic` and re-runs the page's loaders, so `included` always reflects Cloudflare's actual state after the round trip.
 * Clicks are stopped from bubbling because the lists table makes the whole row a navigation target.
 */
export const PolicyListToggle = component$<PolicyListToggleProps>(({ listId, kind, included, label, action }) => {
	const formRef = useSignal<HTMLFormElement>();
	const inputRef = useSignal<HTMLInputElement>();

	// A rejected toggle (Cloudflare error, lookup failure) leaves the loader-backed `included` unchanged, so Qwik has nothing to re-render - the checkbox would keep showing the state the user asked for rather than the state Cloudflare is actually in. Snap it back by hand.
	useTask$(({ track }) => {
		const failed = track(() => actionFailure(action.value) !== undefined);
		if (isServer || !failed || !inputRef.value) return;
		inputRef.value.checked = included;
	});

	return (
		<Form ref={formRef} action={action} class="inline-flex" onClick$={(event) => event.stopPropagation()}>
			<input type="hidden" name="listId" value={listId} />
			<input type="hidden" name="kind" value={kind} />
			<label class={['relative inline-flex h-4.5 w-9 shrink-0 cursor-pointer items-center transition-opacity duration-150', action.isRunning && 'pointer-events-none opacity-60']}>
				<input ref={inputRef} type="checkbox" name="included" value="true" checked={included} disabled={action.isRunning} class="peer sr-only" onChange$={() => formRef.value?.requestSubmit()} />
				<span class={TRACK} />
				<span class={THUMB} />
				<span class="sr-only">{label}</span>
			</label>
		</Form>
	);
});
