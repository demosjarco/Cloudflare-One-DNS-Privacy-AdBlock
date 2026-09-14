import { $, component$, useSignal } from '@builder.io/qwik';
import { LuCheck, LuChevronDown, LuCopy } from '@qwikest/icons/lucide';
import { dohUrl, locationEditUrl, locationInstructionsUrl, type Location } from '~/lib/gateway/locations';

// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore this gets generated automatically later in the build process
import * as m from '~/paraglide/messages';

/*
 * A native `<details>/<summary>` stands in for Kumo's `Collapsible` here rather than hand-rolling Base UI's
 * open/close state machine (height animation via a JS-measured CSS var, `data-starting-style`/
 * `data-ending-style` transitions) - see `theme-toggle.tsx`/`category-toggles.tsx` for why Kumo's own
 * components can't be imported. `<summary>`/panel classes below borrow Kumo's visual language
 * (`Collapsible.DefaultTrigger`/`DefaultPanel`, `@cloudflare/kumo@2.13.2`,
 * `node_modules/@cloudflare/kumo/dist/chunks/collapsible-*.js`) without its animation, which is an
 * acceptable simplification for a read-only info drawer.
 */
const TRIGGER = 'flex cursor-pointer list-none items-center gap-1 text-base font-medium text-kumo-default select-none marker:content-none [&::-webkit-details-marker]:hidden';
const PANEL = 'my-2 space-y-3 border-l-2 border-kumo-fill py-1 pr-1 pl-4';

const CopyableField = component$<{ label: string; value: string }>(({ label, value }) => {
	const copied = useSignal(false);

	const copy = $(async () => {
		await navigator.clipboard.writeText(value);
		copied.value = true;
		setTimeout(() => (copied.value = false), 1500);
	});

	return (
		<div class="flex items-center justify-between gap-2 text-sm">
			<span class="text-kumo-subtle">{label}</span>
			<button type="button" onClick$={copy} class="text-kumo-default hover:bg-kumo-tint flex items-center gap-1 rounded-md px-1.5 py-0.5 font-mono">
				{value}
				{copied.value ? <LuCheck class="text-kumo-success size-3.5" /> : <LuCopy class="size-3.5" />}
				<span class="sr-only">{copied.value ? m.gateway_drawer_copied() : m.gateway_drawer_copy()}</span>
			</button>
		</div>
	);
});

function EndpointState({ label, enabled }: { label: string; enabled: boolean | undefined }) {
	return (
		<div class="flex items-center justify-between gap-2 text-sm">
			<span class="text-kumo-subtle">{label}</span>
			<span class={enabled ? 'text-kumo-success' : 'text-kumo-subtle'}>{enabled ? m.gateway_drawer_endpoint_enabled() : m.gateway_drawer_endpoint_disabled()}</span>
		</div>
	);
}

export interface LocationDrawerProps {
	accountId: string;
	locations: Location[];
}

export const LocationDrawer = component$<LocationDrawerProps>(({ accountId, locations }) => {
	if (locations.length === 0) return null;

	return (
		<div class="flex flex-col gap-2">
			{locations.map((location) => (
				<details key={location.id} class="group">
					<summary class={TRIGGER}>
						<LuChevronDown class="size-3 transition-transform group-open:rotate-180" />
						{location.name}
						<span class="text-kumo-subtle font-normal">- {m.gateway_drawer_trigger()}</span>
					</summary>

					<div class={PANEL}>
						{location.ipv4_destination ? <CopyableField label="IPv4" value={location.ipv4_destination} /> : null}
						{location.ipv4_destination_backup ? <CopyableField label={`IPv4 ${m.gateway_drawer_ipv4_backup()}`} value={location.ipv4_destination_backup} /> : null}
						{location.ip ? <CopyableField label="IPv6" value={location.ip} /> : null}
						{location.doh_subdomain ? <CopyableField label={m.gateway_drawer_doh()} value={dohUrl(location.doh_subdomain)} /> : null}

						<EndpointState label={m.gateway_drawer_dot()} enabled={location.endpoints?.dot.enabled} />

						<div class="flex gap-3 pt-1 text-sm">
							<a href={locationEditUrl(accountId, location.id!)} target="_blank" rel="noreferrer" class="text-kumo-link underline">
								{m.gateway_drawer_edit_link()}
							</a>
							<a href={locationInstructionsUrl(accountId, location.id!)} target="_blank" rel="noreferrer" class="text-kumo-link underline">
								{m.gateway_drawer_instructions_link()}
							</a>
						</div>
					</div>
				</details>
			))}
		</div>
	);
});
