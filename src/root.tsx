import { component$, useServerData, useVisibleTask$ } from '@builder.io/qwik';
import { QwikCityProvider, RouterOutlet, ServiceWorkerRegister } from '@builder.io/qwik-city';
import { initFlowbite } from 'flowbite';
import { RouterHead } from './components/router-head/router-head';

import './global.css';

/*
 * Kumo (https://github.com/cloudflare/kumo) only switches its color tokens via a `data-mode="dark"|"light"` attribute - per its own CHANGELOG.md: "If no `data-mode` is set, the system defaults to light mode." There's no built-in OS-preference fallback once Tailwind's cascade layers are involved.
 * For an explicit light/dark preference, entry.ssr.tsx already renders `data-mode` server-side (see `containerAttributes`) - no flash, nothing for this script to do. `data-theme-preference` is only left as "system" (its default) when there's no stored preference yet, so this only has work to do in that case: sync `data-mode` to `prefers-color-scheme` and keep it live for as long as the preference stays "system" (ThemeToggle flips `data-theme-preference` directly when the user picks light/dark, which this listener checks before touching `data-mode` again).
 */
const themeSyncScript = `(()=>{try{const r=document.documentElement,q=window.matchMedia("(prefers-color-scheme: dark)"),sync=()=>{if(r.dataset.themePreference==="system")r.dataset.mode=q.matches?"dark":"light"};sync();q.addEventListener("change",sync)}catch{}})();`;

export default component$(() => {
	const nonce = useServerData<string | undefined>('nonce');

	// eslint-disable-next-line qwik/no-use-visible-task
	useVisibleTask$(() => {
		initFlowbite();
	});

	return (
		<QwikCityProvider>
			<head>
				<meta charset="utf-8" />
				<script nonce={nonce} dangerouslySetInnerHTML={themeSyncScript} />
				<link rel="manifest" href="/manifest.json" />
				<RouterHead />
			</head>
			<body lang="en">
				<RouterOutlet />
				<ServiceWorkerRegister nonce={nonce} />
			</body>
		</QwikCityProvider>
	);
});
