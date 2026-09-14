import { component$ } from '@builder.io/qwik';
import { routeLoader$, type DocumentHead } from '@builder.io/qwik-city';
import { useMemberships } from '~/routes/layout';

/** Skip the account-picker sidebar entirely when there's nothing to pick - a single verified account is the only sensible destination anyway. */
// eslint-disable-next-line qwik/loader-location
const useRedirectToOnlyAccount = routeLoader$(async ({ resolveValue, redirect }) => {
	const accounts = await resolveValue(useMemberships);
	if (accounts.failed) return;

	const [onlyAccount] = accounts;
	if (onlyAccount) throw redirect(302, `/${onlyAccount.id}/`);
});

export const head: DocumentHead = {
	title: 'Welcome to Qwik',
	meta: [
		{
			name: 'description',
			content: 'Qwik site description',
		},
	],
};

export default component$(() => {
	useRedirectToOnlyAccount();

	return (
		<>
			<h1>Hi 👋</h1>
			<div>
				Can't wait to see what you build with qwik!
				<br />
				Happy coding.
			</div>
		</>
	);
});
