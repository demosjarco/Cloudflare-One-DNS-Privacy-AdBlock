import type { ErrorPageParam } from '@auth/core/types';
import { component$ } from '@builder.io/qwik';
import { Link, routeLoader$ } from '@builder.io/qwik-city';
import { LuAlertTriangle, LuArrowLeft, LuServerCrash, LuShieldAlert, LuUserPlus } from '@qwikest/icons/lucide';
import * as zm from 'zod/mini';

// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore this gets generated automatically later in the build process
import * as m from '~/paraglide/messages';

type ErrorType = ErrorPageParam | 'default';

const useError = routeLoader$(({ query }) =>
	zm
		.object({
			error: zm.catch(zm.enum(['AccessDenied', 'Configuration', 'Verification', 'default'] satisfies ErrorType[]), 'default'),
		})
		.parseAsync(Object.fromEntries(query.entries()))
		.then(({ error }) => error),
);

const errorConfig: Record<ErrorType, { icon: typeof LuAlertTriangle; heading: () => string; message: () => string; iconBg: string; iconColor: string }> = {
	default: {
		icon: LuAlertTriangle,
		heading: () => m.error_heading_default(),
		message: () => m.error_message_default(),
		iconBg: 'bg-kumo-warning-tint',
		iconColor: 'text-kumo-warning',
	},
	Configuration: {
		icon: LuServerCrash,
		heading: () => m.error_heading_configuration(),
		message: () => m.error_message_configuration(),
		iconBg: 'bg-kumo-danger-tint',
		iconColor: 'text-kumo-danger',
	},
	AccessDenied: {
		icon: LuUserPlus,
		heading: () => m.error_heading_access_denied(),
		message: () => m.error_message_access_denied(),
		iconBg: 'bg-kumo-info-tint',
		iconColor: 'text-kumo-info',
	},
	Verification: {
		icon: LuShieldAlert,
		heading: () => m.error_heading_verification(),
		message: () => m.error_message_verification(),
		iconBg: 'bg-kumo-tint',
		iconColor: 'text-kumo-brand-orange',
	},
};

export default component$(() => {
	const errorParam = useError();
	const config = errorConfig[errorParam.value];
	const Icon = config.icon;

	return (
		<div class="bg-kumo-canvas flex min-h-screen items-center justify-center px-4 py-12">
			<div class="w-full max-w-sm">
				<div class="bg-kumo-base ring-kumo-line rounded-lg p-8 shadow-xs ring">
					{/* Icon */}
					<div class="mb-5 flex justify-center">
						<div class={`rounded-full p-4 ${config.iconBg} ${config.iconColor}`}>
							<Icon class="h-6 w-6" />
						</div>
					</div>

					{/* Heading */}
					<h1 class="text-kumo-strong mb-2 text-center text-lg font-semibold">{config.heading()}</h1>

					{/* Message */}
					<p class="text-kumo-subtle mb-6 text-center text-sm leading-relaxed">{config.message()}</p>

					{/* Back to login button */}
					<Link prefetch="js" href="/login" class="bg-kumo-brand ring-kumo-brand hover:bg-kumo-brand-hover focus-visible:ring-kumo-brand flex h-10 w-full cursor-pointer items-center justify-center gap-2 rounded-lg px-4 text-sm font-medium text-white shadow-xs ring transition-colors focus:outline-none focus-visible:ring-2 active:scale-[0.98]">
						<LuArrowLeft class="h-4 w-4" />
						{m.back_to_login()}
					</Link>
				</div>
			</div>
		</div>
	);
});
