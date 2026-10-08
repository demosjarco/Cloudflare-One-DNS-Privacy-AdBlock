import { OVERFLOW_STRATEGIES, type OverflowStrategy } from '~/lib/blocklist/pihole';
import { SUGGESTED_ENTRY_LIMITS } from '~/lib/gateway/lists';

// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore this gets generated automatically later in the build process
import * as m from '~/paraglide/messages';

/** Hand-merged from Kumo's `buttonVariants` (`@cloudflare/kumo@2.13.2`) the same way `tri-state-control.tsx` does - primary/secondary/danger, `size="base"`. */
export const BUTTON_PRIMARY = 'inline-flex h-8 cursor-pointer items-center justify-center gap-1.5 rounded-md bg-kumo-brand px-3 text-sm font-medium text-white shadow-xs ring ring-kumo-brand select-none hover:bg-kumo-brand-hover focus:outline-none focus-visible:ring-2 focus-visible:ring-kumo-brand disabled:cursor-not-allowed disabled:opacity-60';
export const BUTTON_SECONDARY = 'inline-flex h-8 cursor-pointer items-center justify-center gap-1.5 rounded-md bg-kumo-base px-3 text-sm font-medium text-kumo-default shadow-xs ring ring-kumo-line select-none hover:bg-kumo-tint focus:outline-none focus-visible:ring-2 focus-visible:ring-kumo-brand disabled:cursor-not-allowed disabled:opacity-60';
export const BUTTON_DANGER = 'inline-flex h-8 cursor-pointer items-center justify-center gap-1.5 rounded-md bg-kumo-base px-3 text-sm font-medium text-kumo-danger shadow-xs ring ring-kumo-line select-none hover:ring-kumo-danger/30 focus:outline-none focus-visible:ring-2 focus-visible:ring-kumo-danger disabled:cursor-not-allowed disabled:opacity-60';
export const INPUT = 'h-8 rounded-md bg-kumo-base px-2.5 text-sm text-kumo-default shadow-xs ring ring-kumo-line placeholder:text-kumo-subtle focus:outline-none focus-visible:ring-2 focus-visible:ring-kumo-brand disabled:cursor-not-allowed disabled:opacity-60';
export const SELECT = 'h-8 cursor-pointer rounded-md bg-kumo-base px-2.5 text-sm text-kumo-default shadow-xs ring ring-kumo-line focus:outline-none focus-visible:ring-2 focus-visible:ring-kumo-brand disabled:cursor-not-allowed disabled:opacity-60';

export function overflowLabel(strategy: OverflowStrategy): string {
	switch (strategy) {
		case 'first':
			return m.lists_overflow_first();
		case 'last':
			return m.lists_overflow_last();
		case 'sortedFirst':
			return m.lists_overflow_sorted_first();
		case 'sortedLast':
			return m.lists_overflow_sorted_last();
		case 'random':
			return m.lists_overflow_random();
	}
}

export const OVERFLOW_OPTIONS = OVERFLOW_STRATEGIES.map((value) => ({ value, label: overflowLabel(value) }));

/** `<datalist>` suggestions for the free-form entry-limit input - see the `SUGGESTED_ENTRY_LIMITS` note in `lists.ts` for why this is typed in rather than detected. */
export const ENTRY_LIMIT_SUGGESTIONS = [
	{ value: SUGGESTED_ENTRY_LIMITS.standard, label: m.lists_limit_option_standard() },
	{ value: SUGGESTED_ENTRY_LIMITS.enterprise, label: m.lists_limit_option_enterprise() },
];

export interface ActionFailure {
	/** Stable error code set by the action via `event.fail(status, { error })`, or `undefined` for a `zod$` validation failure. */
	error: string | undefined;
	/** Upstream (Cloudflare / fetch) message, when the action chose to pass one through. */
	message: string | undefined;
	validation: boolean;
	/** Field names the `zod$` validator rejected, so the UI can say which input is wrong. */
	invalidFields: string[];
}

/**
 * `ActionStore.value` is a union of every `fail()` shape plus the validator's `{ fieldErrors, formErrors }` - the members don't all carry `message`, so reading it directly doesn't type-check. One narrowing helper instead of a cast at each call site.
 */
export function actionFailure(value: unknown): ActionFailure | undefined {
	if (typeof value !== 'object' || value === null || !('failed' in value) || !value.failed) return undefined;

	const record = value as Record<string, unknown>;
	const fieldErrors = typeof record['fieldErrors'] === 'object' && record['fieldErrors'] !== null ? (record['fieldErrors'] as Record<string, unknown>) : undefined;
	return {
		error: typeof record['error'] === 'string' ? record['error'] : undefined,
		message: typeof record['message'] === 'string' ? record['message'] : undefined,
		validation: fieldErrors !== undefined || record['formErrors'] !== undefined,
		invalidFields: fieldErrors ? Object.keys(fieldErrors).filter((field) => fieldErrors[field] !== undefined) : [],
	};
}
