import { component$ } from '@builder.io/qwik';
import { useLocation } from '@builder.io/qwik-city';
import { LuExternalLink, LuRefreshCw } from '@qwikest/icons/lucide';
import { BUTTON_PRIMARY, BUTTON_SECONDARY } from '~/components/lists/shared';

// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore this gets generated automatically later in the build process
import * as m from '~/paraglide/messages';

/**
 * Shown in place of Cloudflare's raw `1001` when an action hits an account that never went through Zero Trust onboarding (see `isZeroTrustUninitialized` in `list-sync.ts`). Onboarding happens in a new tab; "Refresh" is a plain link back to this page rather than `<Link>`, so it's a full reload that re-runs every loader and drops the failed action's state.
 */
export const ZeroTrustSetupNotice = component$(() => {
	const location = useLocation();

	return (
		<div role="alert" class="bg-kumo-warning-tint ring-kumo-line flex flex-col gap-3 rounded-lg p-4 text-sm ring">
			<div class="flex flex-col gap-1">
				<p class="text-kumo-strong font-semibold">{m.zero_trust_setup_heading()}</p>
				<p class="text-kumo-default">{m.zero_trust_setup_message()}</p>
			</div>
			<div class="flex flex-wrap items-center gap-2">
				{/* Zero Trust's home in the dashboard - an account that hasn't been onboarded is sent into onboarding from here. Same `/{account}/one/...` shape as the links in `locations.ts`. */}
				<a href={`https://dash.cloudflare.com/${location.params['accountId']}/one`} target="_blank" rel="noreferrer" class={BUTTON_PRIMARY}>
					{m.zero_trust_setup_link()}
					<LuExternalLink class="size-3.5" />
				</a>
				<a href={location.url.pathname} class={BUTTON_SECONDARY}>
					<LuRefreshCw class="size-4" />
					{m.zero_trust_setup_refresh()}
				</a>
			</div>
		</div>
	);
});
