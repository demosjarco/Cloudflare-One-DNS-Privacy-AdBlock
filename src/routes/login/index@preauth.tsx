import { component$ } from '@builder.io/qwik';
import { SiCloudflare } from '@qwikest/icons/simpleicons';
import { useSignIn } from '~/routes/plugin@auth';

// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore this gets generated automatically later in the build process
import * as m from '~/paraglide/messages';

export default component$(() => {
	const signIn = useSignIn();

	return (
		<div class="bg-kumo-canvas flex min-h-screen items-center justify-center px-4 py-12">
			<div class="w-full max-w-sm">
				<div class="bg-kumo-base ring-kumo-line rounded-lg p-8 shadow-xs ring">
					<h1 class="text-kumo-strong mb-6 text-center text-lg font-semibold">{m.login_heading()}</h1>

					<button type="button" onClick$={() => signIn.submit({ providerId: 'cloudflare', redirectTo: '/' })} class="bg-kumo-brand ring-kumo-brand hover:bg-kumo-brand-hover focus-visible:ring-kumo-brand flex h-10 w-full cursor-pointer items-center justify-center gap-2 rounded-lg px-4 text-sm font-medium text-white shadow-xs ring transition-colors focus:outline-none focus-visible:ring-2 active:scale-[0.98]">
						<SiCloudflare class="h-4 w-4" />
						{m.login_with_cloudflare()}
					</button>
				</div>

				<p class="text-kumo-subtle mt-6 text-center text-xs">{m.login_disclaimer()}</p>
				<p class="text-kumo-subtle mt-1 text-center text-xs">
					{m.login_built_with_prefix()}{' '}
					<a href="https://qwik.dev" target="_blank" rel="noopener noreferrer" class="text-kumo-subtle hover:text-kumo-default underline">
						Qwik
					</a>{' '}
					{m.login_built_with_and()}{' '}
					<a href="https://kumo-ui.com" target="_blank" rel="noopener noreferrer" class="text-kumo-subtle hover:text-kumo-default underline">
						Kumo
					</a>{' '}
					{m.login_built_with_kumo_suffix()}.
				</p>
			</div>
		</div>
	);
});
