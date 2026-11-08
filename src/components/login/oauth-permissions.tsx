import { component$, type Component } from '@builder.io/qwik';
import { LuChevronDown, LuRefreshCw, LuShieldCheck, LuUser, LuUsers } from '@qwikest/icons/lucide';

// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore this gets generated automatically later in the build process
import * as m from '~/paraglide/messages';

/*
 * Flowbite's Collapse (`data-collapse-toggle`, initialized by `initCollapses()` in `root.tsx`) toggles the panel's
 * `hidden` class and the trigger's `aria-expanded` - the chevron rotation keys off that attribute via `group-aria-expanded:`.
 * Styling is Kumo tokens only, so it matches the card around it in both themes.
 *
 * Keep `scope` in sync with the `authorization.params.scope` list in `~/lib/auth/cloudflare-provider.ts`.
 */
interface Grant {
	scope: string;
	optional?: boolean;
	icon: Component<{ class?: string }>;
	title: () => string;
	reason: () => string;
}

// Same order and titles as Cloudflare's consent screen, so the two can be matched up side by side.
const GRANTS: readonly Grant[] = [
	{ scope: 'offline_access', icon: LuRefreshCw, title: m.login_permissions_offline_title, reason: m.login_permissions_offline_reason },
	{ scope: 'teams.write', icon: LuShieldCheck, title: m.login_permissions_teams_title, reason: m.login_permissions_teams_reason },
	{ scope: 'memberships.read', icon: LuUsers, title: m.login_permissions_memberships_title, reason: m.login_permissions_memberships_reason },
	{ scope: 'user-details.read', optional: true, icon: LuUser, title: m.login_permissions_user_title, reason: m.login_permissions_user_reason },
];

const PANEL_ID = 'oauth-permissions-panel';

export const OAuthPermissions = component$(() => {
	return (
		<div class="border-kumo-line mt-6 border-t pt-4">
			<button type="button" data-collapse-toggle={PANEL_ID} aria-controls={PANEL_ID} aria-expanded="false" class="group text-kumo-subtle hover:text-kumo-default focus-visible:ring-kumo-brand flex w-full cursor-pointer items-center justify-between gap-2 rounded-md text-xs font-medium focus:outline-none focus-visible:ring-2">
				{m.login_permissions_trigger()}
				<LuChevronDown class="size-3.5 shrink-0 transition-transform group-aria-expanded:rotate-180" />
			</button>

			<div id={PANEL_ID} class="hidden pt-3">
				<p class="text-kumo-subtle mb-3 text-xs">{m.login_permissions_intro()}</p>

				<ul class="space-y-3">
					{GRANTS.map(({ scope, optional, icon: Icon, title, reason }) => (
						<li key={scope} class="flex gap-2.5">
							<Icon class="text-kumo-brand mt-0.5 size-4 shrink-0" />
							<div class="min-w-0 text-xs">
								<div class="flex flex-wrap items-center gap-x-1.5 gap-y-0.5">
									<span class="text-kumo-strong font-medium">{title()}</span>
									<code class="bg-kumo-tint text-kumo-subtle rounded px-1 py-px font-mono text-[0.6875rem]">{scope}</code>
									{optional ? <span class="text-kumo-subtle ring-kumo-line rounded px-1 py-px text-[0.6875rem] ring">{m.login_permissions_optional()}</span> : null}
								</div>
								<p class="text-kumo-default mt-0.5">{reason()}</p>
							</div>
						</li>
					))}
				</ul>

				<p class="text-kumo-subtle mt-3 text-xs">
					{m.login_permissions_revoke()}
					{
						' '
						/**
						 * Left untranslated on purpose: it names Cloudflare's own (English) dashboard menu items, as shown on its consent screen.
						 * @link https://developers.cloudflare.com/changelog/post/2026-04-14-oauth-consent-and-revoke/
						 */
					}
					<a href="https://dash.cloudflare.com/profile/access-management/authorization" target="_blank" rel="noopener noreferrer" class="text-kumo-link underline">
						My Profile → Access Management → Connected Applications
					</a>
				</p>
			</div>
		</div>
	);
});
