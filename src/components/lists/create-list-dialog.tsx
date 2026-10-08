import { component$, useSignal } from '@builder.io/qwik';
import { Form, type ActionStore } from '@builder.io/qwik-city';
import { LuPlus } from '@qwikest/icons/lucide';
import { SUGGESTED_ENTRY_LIMITS } from '~/lib/gateway/lists';
import { actionFailure, BUTTON_PRIMARY, BUTTON_SECONDARY, ENTRY_LIMIT_SUGGESTIONS, INPUT, OVERFLOW_OPTIONS, SELECT } from './shared';

// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore this gets generated automatically later in the build process
import * as m from '~/paraglide/messages';

export interface CreateListDialogProps {
	/** Disables the trigger once the account is at Cloudflare's 100-list quota. */
	quotaReached: boolean;
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	action: ActionStore<any, any>;
}

/**
 * A native `<dialog>` instead of Flowbite's modal: `showModal()` gives focus trapping, Escape-to-close and a top-layer backdrop for free, with no data-attribute wiring to keep in sync with Flowbite's init. A successful submit never closes it from here - the action redirects straight into the new list.
 */
export const CreateListDialog = component$<CreateListDialogProps>(({ quotaReached, action }) => {
	const dialogRef = useSignal<HTMLDialogElement>();

	const failure = actionFailure(action.value);
	let failureText: string | undefined;
	if (failure?.validation) failureText = failure.invalidFields.includes('limit') ? m.lists_error_invalid_limit() : m.lists_error_invalid_url();
	else if (failure?.error === 'quota') failureText = m.lists_error_quota();
	else if (failure?.error === 'duplicate') failureText = m.lists_error_duplicate();
	else if (failure?.error === 'fetch-http') failureText = m.lists_error_fetch_http();
	else if (failure?.error === 'fetch-network') failureText = m.lists_error_fetch_network();
	else if (failure?.error === 'fetch-empty') failureText = m.lists_error_fetch_empty();
	else if (failure?.error === 'fetch-too-large') failureText = m.lists_error_fetch_too_large();
	else if (failure?.error === 'cloudflare') failureText = m.lists_error_cloudflare({ message: failure.message ?? '' });
	else if (failure) failureText = m.lists_error_generic();

	return (
		<>
			<button type="button" class={BUTTON_PRIMARY} disabled={quotaReached} onClick$={() => dialogRef.value?.showModal()}>
				<LuPlus class="size-4" />
				{m.lists_create_button()}
			</button>

			<dialog ref={dialogRef} class="bg-kumo-base text-kumo-default ring-kumo-line m-auto w-full max-w-md rounded-lg p-0 shadow-lg ring backdrop:bg-black/40">
				<Form action={action} class="flex flex-col gap-4 p-5">
					<h2 class="text-kumo-strong text-lg font-semibold">{m.lists_create_heading()}</h2>

					<label class="flex flex-col gap-1.5 text-sm">
						<span class="text-kumo-default font-medium">{m.lists_create_url_label()}</span>
						<input type="url" name="url" required placeholder="https://example.com/hosts.txt" class={[INPUT, 'w-full']} disabled={action.isRunning} />
						<span class="text-kumo-subtle text-xs">{m.lists_create_url_hint()}</span>
					</label>

					<label class="flex flex-col gap-1.5 text-sm">
						<span class="text-kumo-default font-medium">{m.lists_limit_label()}</span>
						<input type="number" name="limit" {...{ list: 'create-list-entry-limits' }} min={SUGGESTED_ENTRY_LIMITS.standard} step={1} required value={SUGGESTED_ENTRY_LIMITS.standard} class={[INPUT, 'w-full']} disabled={action.isRunning} />
						<datalist id="create-list-entry-limits">
							{ENTRY_LIMIT_SUGGESTIONS.map((option) => (
								<option key={option.value} value={option.value}>
									{option.label}
								</option>
							))}
						</datalist>
						<span class="text-kumo-subtle text-xs">{m.lists_limit_hint()}</span>
					</label>

					<label class="flex flex-col gap-1.5 text-sm">
						<span class="text-kumo-default font-medium">{m.lists_overflow_label()}</span>
						<select name="overflow" class={[SELECT, 'w-full']} disabled={action.isRunning}>
							{OVERFLOW_OPTIONS.map((option) => (
								<option key={option.value} value={option.value}>
									{option.label}
								</option>
							))}
						</select>
					</label>

					{failureText ? <p class="text-kumo-danger text-sm">{failureText}</p> : null}

					<div class="flex justify-end gap-2">
						<button type="button" class={BUTTON_SECONDARY} disabled={action.isRunning} onClick$={() => dialogRef.value?.close()}>
							{m.lists_create_cancel()}
						</button>
						<button type="submit" class={BUTTON_PRIMARY} disabled={action.isRunning}>
							{action.isRunning ? m.lists_create_running() : m.lists_create_submit()}
						</button>
					</div>
				</Form>
			</dialog>
		</>
	);
});
