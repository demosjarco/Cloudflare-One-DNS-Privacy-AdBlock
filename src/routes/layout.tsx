import { getToken } from '@auth/core/jwt';
import type { Session } from '@auth/qwik';
import { component$, noSerialize, Resource, Slot, useComputed$ } from '@builder.io/qwik';
import { Form, Link, routeLoader$, useLocation, type RequestHandler } from '@builder.io/qwik-city';
import { LuChevronDown, LuLogOut, LuMenu } from '@qwikest/icons/lucide';
import { APIError } from 'cloudflare';
import { BaseMemberships } from 'cloudflare/resources/memberships/memberships';
import { BaseUser } from 'cloudflare/resources/user/user';
import { createClient } from 'cloudflare/tree-shakable';
import { useSignOut } from '~/routes/plugin@auth';
import { locales as inlangLocales } from '../../project.inlang/settings.json' with { type: 'json' };

// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore this gets generated automatically later in the build process
import { setLocale } from '~/paraglide/runtime';
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore this gets generated automatically later in the build process
import * as m from '~/paraglide/messages';

export interface Accept {
	type: string;
	params: Record<string, string>;
	q: number;
}

/**
 * @link https://github.com/honojs/hono/blob/main/src/middleware/language/language.ts
 */
export const onRequest: RequestHandler = async ({ sharedMap, platform, redirect, url, request, locale }) => {
	// Session
	const session = sharedMap.get('session') as Session | null;
	// If there's no session, we can't do any binding checks, so we redirect to sign in immediately. This also avoids running the binding check code for unauthenticated users, which would be a waste of resources.
	if (!session) throw redirect(307, `/auth/signin?callbackUrl=${url.pathname}`);

	await Promise.allSettled([
		// Locale
		(async () => {
			const parseParams = (paramParts: string[]): Record<string, string> => {
				return paramParts.reduce<Record<string, string>>((acc, param) => {
					const [key, val] = param.split('=').map((s) => s.trim());
					if (key && val) {
						acc[key] = val;
					}
					return acc;
				}, {});
			};
			const parseQuality = (qVal?: string): number => {
				if (qVal === undefined) {
					return 1;
				}
				if (qVal === '') {
					return 1;
				}
				if (qVal === 'NaN') {
					return 0;
				}

				const num = Number(qVal);
				if (num === Infinity) {
					return 1;
				}
				if (num === -Infinity) {
					return 0;
				}
				if (Number.isNaN(num)) {
					return 1;
				}
				if (num < 0 || num > 1) {
					return 1;
				}

				return num;
			};

			const parseAcceptValue = ({ value, index }: { value: string; index: number }) => {
				const parseAcceptValueRegex = /;(?=(?:(?:[^"]*"){2})*[^"]*$)/;
				const parts = value
					.trim()
					.split(parseAcceptValueRegex)
					.map((s) => s.trim());
				const type = parts[0];
				if (!type) {
					return null;
				}

				const params = parseParams(parts.slice(1));
				const q = parseQuality(params['q']);

				return { type, params, q, index };
			};
			const sortByQualityAndIndex = (a: Accept & { index: number }, b: Accept & { index: number }) => {
				const qDiff = b.q - a.q;
				if (qDiff !== 0) {
					return qDiff;
				}
				return a.index - b.index;
			};

			const parseAccept = (acceptHeader: string): Accept[] => {
				if (!acceptHeader) {
					return [];
				}

				const acceptValues = acceptHeader.split(',').map((value, index) => ({ value, index }));

				return acceptValues
					.map(parseAcceptValue)
					.filter((item): item is Accept & { index: number } => Boolean(item))
					.sort(sortByQualityAndIndex)
					.map(({ type, params, q }) => ({ type, params, q }));
			};

			function parseAcceptLanguage(header: string): { lang: string; q: number }[] {
				return parseAccept(header).map(({ type, q }) => ({ lang: type, q }));
			}

			const headers = (platform.request ?? request).headers;

			if (headers.has('Accept-Language')) {
				const parsedLocales = parseAcceptLanguage(headers.get('Accept-Language')!);
				if (parsedLocales[0]?.lang) locale(parsedLocales[0]?.lang);

				// Strip out language subtags
				const parsedSingleLocales = Array.from(new Set(parsedLocales.map(({ lang }) => lang.split('-')[0]).filter((lang) => lang !== undefined)));
				// Make `Set` to avoid O(n²)
				const paraglideLocalesSet = new Set(inlangLocales);
				// Runtime check (since JSON isn't strongly typed)
				const paraglideLocale = parsedSingleLocales.find((lang) => paraglideLocalesSet.has(lang)) as Parameters<typeof setLocale>[0] | undefined;
				if (paraglideLocale) await setLocale(paraglideLocale);
			}
		})(),
	]);
};

export function rawTimezone(platform: QwikCityPlatform, locale: Intl.LocalesArgument) {
	const long = ((platform.request ?? platform).cf as IncomingRequestCfProperties).timezone;

	return {
		long,
		short: new Intl.DateTimeFormat(locale, { timeZoneName: 'short', timeZone: long }).formatToParts(new Date()).find((p) => p.type === 'timeZoneName')?.value,
	} as const;
}
export const useTimezone = routeLoader$(({ platform, locale }) => {
	return rawTimezone(platform, locale());
});

export const useLocale = routeLoader$(({ locale }) => locale());

export const useAuthToken = routeLoader$(async ({ request, platform, url }) => {
	const token = await getToken({
		req: request,
		secret: platform.env.AUTH_SECRET,
		secureCookie: url.protocol === 'https:',
	});
	// noSerialize doesn't accept `null` literals
	return noSerialize(token ?? undefined);
});

export const useCloudflareApi = routeLoader$(async ({ resolveValue, fail }) => {
	const token = await resolveValue(useAuthToken);

	if (token?.cloudflare?.accessToken) {
		return noSerialize(
			createClient({
				apiToken: token?.cloudflare?.accessToken,
				resources: [BaseMemberships, BaseUser],
			}),
		);
	} else {
		return fail(401, { error: 'No Cloudflare access token on this session.' });
	}
});

/** @link https://developers.cloudflare.com/api/resources/memberships/methods/list/ */
export const useMemberships = routeLoader$(({ resolveValue, error }) => async () => {
	const client = await resolveValue(useCloudflareApi);
	if (client.failed) throw error(401, 'No Cloudflare access token on this session.');

	try {
		const memberships = await Array.fromAsync(client.memberships.list());

		// Pending/rejected memberships don't grant any actual account access, so they'd just be dead links in the switcher.
		return memberships.filter((membership) => membership.status === 'accepted');
	} catch (err) {
		if (err instanceof APIError) throw error(typeof err.status === 'number' ? (err.status as Parameters<typeof error>[0]) : 502, err.message);
		throw err;
	}
});

/**
 * Identity for the account menu at the bottom of the sidebar.
 * `email`/`name` come from `GET /user`, which requires the (optional-on-the-OAuth-app) `user-details.read` scope - when it's missing or the call otherwise fails, only the JWT's `sub` (the Cloudflare user id) is available.
 */
export const useCurrentUser = routeLoader$(({ resolveValue }) => async () => {
	const client = await resolveValue(useCloudflareApi);
	if (!client.failed) {
		try {
			const me = await client.user.get();

			return { email: me.email, name: [me.first_name, me.last_name].filter(Boolean).join(' ') || undefined } as const;
		} catch (err) {
			if (!(err instanceof APIError)) throw err;
		}
	}

	const token = await resolveValue(useAuthToken);
	return { id: token?.sub };
});

/** Only show the name+email pair when both resolved - a lone email (or lone name) is an incomplete profile, so fall back to the bare id instead of a half-filled card. */
function deriveUserDisplay(user: Partial<{ id: string; email: string; name: string }>) {
	const hasProfile = Boolean(user.name && user.email);
	const displayName = hasProfile ? user.name! : (user.id ?? m.sidebar_unknown_user());

	return { hasProfile, displayName, email: user.email };
}

function renderUserTrigger(user: Partial<{ id: string; email: string; name: string }>) {
	const { hasProfile, displayName, email } = deriveUserDisplay(user);

	return (
		<>
			<span class="min-w-0 flex-1 text-left">
				<span class="text-kumo-strong block truncate font-medium">{displayName}</span>
				{hasProfile ? <span class="text-kumo-subtle block truncate text-xs">{email}</span> : null}
			</span>
		</>
	);
}

/** Flowbite only auto-closes a dropdown on an outside click - selecting an item inside it (an account link, the sign-out button) never does, so it has to be closed manually. */
function hideDropdown(id: string) {
	(window as { FlowbiteInstances?: { getInstance: (component: string, id: string) => { hide: () => void } | undefined } }).FlowbiteInstances?.getInstance('Dropdown', id)?.hide();
}

function renderUserPanel(user: Partial<{ id: string; email: string; name: string }>) {
	const { hasProfile, displayName, email } = deriveUserDisplay(user);

	return (
		<div class="px-2 py-3 text-sm">
			<div class="text-kumo-strong truncate font-medium">{displayName}</div>
			{hasProfile ? <div class="text-kumo-subtle truncate">{email}</div> : null}
		</div>
	);
}

export default component$(() => {
	const memberships = useMemberships();
	const currentUser = useCurrentUser();
	const signOut = useSignOut();
	const location = useLocation();

	const currentAccountId = useComputed$(() => location.params['accountId']);

	return (
		<div class="bg-kumo-canvas min-h-screen">
			<button type="button" data-drawer-target="app-sidebar" data-drawer-toggle="app-sidebar" aria-controls="app-sidebar" class="ring-kumo-line bg-kumo-base text-kumo-default fixed top-3 left-3 z-50 inline-flex items-center rounded-lg p-2 ring sm:hidden">
				<span class="sr-only">{m.sidebar_open_menu()}</span>
				<LuMenu class="h-5 w-5" />
			</button>

			<aside id="app-sidebar" aria-label="Sidebar" class="bg-kumo-base border-kumo-line fixed top-0 left-0 z-40 flex h-screen w-64 -translate-x-full flex-col border-r transition-transform sm:translate-x-0">
				{/* Account switcher */}
				<div class="border-kumo-line border-b p-3">
					<button id="account-switcher-button" type="button" data-dropdown-toggle="account-switcher-menu" class="ring-kumo-line hover:bg-kumo-tint flex w-full items-center justify-between gap-2 rounded-lg px-3 py-2 text-sm ring">
						<span class="text-kumo-strong truncate font-medium">
							<Resource value={memberships} onPending={() => m.sidebar_select_account()} onRejected={() => m.sidebar_select_account()} onResolved={(resolvedMemberships) => resolvedMemberships.find((membership) => membership.account?.id === currentAccountId.value)?.account?.name ?? m.sidebar_select_account()} />
						</span>
						<LuChevronDown class="text-kumo-subtle h-4 w-4 shrink-0" />
					</button>

					<div id="account-switcher-menu" class="bg-kumo-base ring-kumo-line z-10 hidden w-56 overflow-hidden rounded-lg p-1.5 shadow-lg ring">
						<Resource
							value={memberships}
							onPending={() => (
								<div class="space-y-2 px-2 py-3">
									<div class="bg-kumo-tint h-3 w-3/4 animate-pulse rounded" />
									<div class="bg-kumo-tint h-3 w-1/2 animate-pulse rounded" />
								</div>
							)}
							onRejected={() => <p class="text-kumo-danger px-2 py-3 text-xs">{m.sidebar_accounts_error()}</p>}
							onResolved={(resolvedMemberships) =>
								resolvedMemberships.length === 0 ? (
									<p class="text-kumo-subtle px-2 py-3 text-xs">{m.sidebar_no_accounts()}</p>
								) : (
									<ul class="max-h-64 overflow-y-auto text-sm" aria-labelledby="account-switcher-button">
										{resolvedMemberships.map((membership) => (
											<li key={membership.id}>
												<Link href={`/${membership.account?.id}/`} onClick$={() => hideDropdown('account-switcher-menu')} class={['hover:bg-kumo-tint block truncate rounded-md px-2 py-1.5', membership.account?.id === currentAccountId.value ? 'text-kumo-brand font-medium' : 'text-kumo-default']}>
													{membership.account?.name}
												</Link>
											</li>
										))}
									</ul>
								)
							}
						/>
					</div>
				</div>

				<div class="flex-1" />

				{/* User menu */}
				<div class="border-kumo-line border-t p-3">
					<button id="user-menu-button" type="button" data-dropdown-toggle="user-menu" data-dropdown-placement="top" class="hover:bg-kumo-tint flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm">
						<Resource
							value={currentUser}
							onPending={() => (
								<span class="min-w-0 flex-1 text-left">
									<span class="bg-kumo-tint block h-3 w-24 animate-pulse rounded" />
								</span>
							)}
							onRejected={() => renderUserTrigger({})}
							onResolved={renderUserTrigger}
						/>
					</button>

					<div id="user-menu" class="bg-kumo-base ring-kumo-line z-10 hidden w-56 overflow-hidden rounded-lg p-1.5 shadow-lg ring">
						<Resource value={currentUser} onPending={() => renderUserPanel({})} onRejected={() => renderUserPanel({})} onResolved={renderUserPanel} />
						<div class="bg-kumo-line -mx-1.5 my-1.5 h-px" />
						<Form action={signOut}>
							<input type="hidden" name="redirectTo" value="/login" />
							<button type="submit" onClick$={() => hideDropdown('user-menu')} class="text-kumo-danger hover:bg-kumo-tint flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm">
								<LuLogOut class="h-4 w-4" />
								{m.sidebar_sign_out()}
							</button>
						</Form>
					</div>
				</div>
			</aside>

			<main class="min-h-screen p-4 pt-16 sm:ml-64 sm:pt-4">
				<Slot />
			</main>
		</div>
	);
});
