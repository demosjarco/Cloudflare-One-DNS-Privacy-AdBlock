import { component$ } from '@builder.io/qwik';
import { Link, routeLoader$, type DocumentHead } from '@builder.io/qwik-city';
import { LuChevronRight } from '@qwikest/icons/lucide';
import { useMemberships } from '~/routes/layout';

// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore this gets generated automatically later in the build process
import * as m from '~/paraglide/messages';

/** Skip the account-picker sidebar entirely when there's nothing to pick - a single verified account is the only sensible destination anyway. */
// eslint-disable-next-line qwik/loader-location
const useRedirectToOnlyAccount = routeLoader$(async ({ resolveValue, redirect }) => {
	const accounts = await resolveValue(useMemberships);
	if (accounts.failed) return;

	const [onlyAccount] = accounts;
	if (onlyAccount) throw redirect(302, `/${onlyAccount.id}/`);
});

// Function form on purpose: the locale is set per request in `routes/layout.tsx`'s `onRequest`, so a static object would bake in whatever locale was active at module load.
export const head: DocumentHead = () => ({
	title: m.page_title_accounts(),
	meta: [
		{
			name: 'description',
			content: m.accounts_intro(),
		},
	],
});

/** Only ever rendered with zero or several verified accounts (or a failed lookup) - exactly one redirects in `useRedirectToOnlyAccount`. */
export default component$(() => {
	useRedirectToOnlyAccount();
	const memberships = useMemberships();
	const accounts = memberships.value;

	return (
		<div class="mx-auto flex w-full max-w-2xl flex-col gap-4">
			<header>
				<h1 class="text-kumo-strong text-xl font-semibold">{m.accounts_heading()}</h1>
				<p class="text-kumo-subtle mt-1 text-sm">{m.accounts_intro()}</p>
			</header>

			{accounts.failed ? (
				<p class="text-kumo-danger text-sm">{m.accounts_load_error()}</p>
			) : accounts.length === 0 ? (
				<div class="bg-kumo-base ring-kumo-line rounded-lg p-6 text-center shadow-xs ring">
					<h2 class="text-kumo-strong text-base font-semibold">{m.accounts_empty_heading()}</h2>
					<p class="text-kumo-subtle mt-2 text-sm">{m.accounts_empty_message()}</p>
				</div>
			) : (
				<ul class="bg-kumo-base ring-kumo-line divide-kumo-line divide-y overflow-hidden rounded-lg shadow-xs ring">
					{accounts.map((account) => (
						<li key={account.id}>
							<Link prefetch="js" href={`/${account.id}/`} class="hover:bg-kumo-tint flex items-center justify-between gap-3 px-4 py-3">
								<span class="min-w-0">
									<span class="text-kumo-strong block truncate font-medium">{account.name}</span>
									<span class="text-kumo-subtle block truncate font-mono text-xs">{account.id}</span>
								</span>
								<LuChevronRight class="text-kumo-subtle size-4 shrink-0" />
							</Link>
						</li>
					))}
				</ul>
			)}
		</div>
	);
});
