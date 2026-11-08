import { component$, isServer, useSignal, useTask$ } from '@builder.io/qwik';
import { Form, type ActionStore } from '@builder.io/qwik-city';
import type { PolicyKind } from '~/lib/gateway/policy-expression';
import { actionFailure, SWITCH_LABEL, SWITCH_THUMB, SWITCH_TRACK } from './shared';

export interface PolicyListToggleProps {
	/** Every Cloudflare list of the source (all chunks) - they're wired into the rule together. */
	listIds: string[];
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
export const PolicyListToggle = component$<PolicyListToggleProps>(({ listIds, kind, included, label, action }) => {
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
			{listIds.map((listId) => (
				<input key={listId} type="hidden" name="listIds[]" value={listId} />
			))}
			<input type="hidden" name="kind" value={kind} />
			<label class={[SWITCH_LABEL, action.isRunning && 'pointer-events-none opacity-60']}>
				<input ref={inputRef} type="checkbox" name="included" value="true" checked={included} disabled={action.isRunning} class="peer sr-only" onChange$={() => formRef.value?.requestSubmit()} />
				<span class={SWITCH_TRACK} />
				<span class={SWITCH_THUMB} />
				<span class="sr-only">{label}</span>
			</label>
		</Form>
	);
});
