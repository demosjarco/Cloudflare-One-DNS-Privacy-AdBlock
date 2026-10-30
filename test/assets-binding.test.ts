import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

/**
 * `@builder.io/qwik-city/middleware/cloudflare-pages` serves static paths with `env.ASSETS.fetch(request)`.
 * A differently named binding makes every static request throw `Cannot read properties of undefined (reading 'fetch')`.
 */
test('wrangler assets binding is named ASSETS', () => {
	const config = JSON.parse(readFileSync(new URL('../wrangler.json', import.meta.url), 'utf8')) as { assets?: { binding?: string } };
	assert.equal(config.assets?.binding, 'ASSETS');
});
