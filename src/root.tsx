import { component$, useServerData, useVisibleTask$ } from '@builder.io/qwik';
import { QwikCityProvider, RouterOutlet, ServiceWorkerRegister } from '@builder.io/qwik-city';
import { initDrawers } from 'flowbite/lib/esm/components/drawer';
import { initDropdowns } from 'flowbite/lib/esm/components/dropdown';
import { RouterHead } from './components/router-head/router-head';

import './global.css';

export default component$(() => {
	const nonce = useServerData<string | undefined>('nonce');

	// eslint-disable-next-line qwik/no-use-visible-task
	useVisibleTask$(() => {
		initDropdowns();
		initDrawers();
	});

	return (
		<QwikCityProvider>
			<head>
				<meta charset="utf-8" />
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
