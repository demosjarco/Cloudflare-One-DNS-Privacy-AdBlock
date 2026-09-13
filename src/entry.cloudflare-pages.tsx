import { createQwikCity, type PlatformCloudflarePages } from '@builder.io/qwik-city/middleware/cloudflare-pages';
import qwikCityPlan from '@qwik-city-plan';
import { manifest } from '@qwik-client-manifest';
import type { PlatformProxy } from 'wrangler';
import type { EnvVars } from '~/types';
import render from './entry.ssr';

declare global {
	interface CacheStorage {
		/* [MDN Reference](https://developer.mozilla.org/docs/Web/API/CacheStorage/open) */
		open(cacheName: string): Promise<Cache>;
		readonly default: Cache;
	}

	interface QwikCityPlatformLive extends Omit<PlatformCloudflarePages, 'request' | 'env' | 'ctx'> {
		request: Request;
		env: EnvVars;
		ctx: ExecutionContext;
		cf?: never;
		caches?: never;
	}

	interface QwikCityPlatformLocal extends Omit<PlatformProxy<EnvVars>, 'request'> {
		request?: never;
		caches: CacheStorage;
	}
	type QwikCityPlatform = QwikCityPlatformLive | QwikCityPlatformLocal;
}

const fetch = createQwikCity({ render, qwikCityPlan, manifest });

export { fetch };
