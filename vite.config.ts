import { qwikCity } from '@builder.io/qwik-city/vite';
import { qwikVite } from '@builder.io/qwik/optimizer';
import { nodeResolve } from '@rollup/plugin-node-resolve';
import basicSsl from '@vitejs/plugin-basic-ssl';
import { defineConfig, type UserConfig } from 'vite';
import tsconfigPaths from 'vite-tsconfig-paths';

/**
 * Note that Vite normally starts from `index.html` but the qwikCity plugin makes start at `src/entry.ssr.tsx` instead.
 */
export default defineConfig((): UserConfig => {
	return {
		plugins: [
			qwikCity(),
			qwikVite(),
			tsconfigPaths({ root: '.' }),
			nodeResolve({
				browser: true,
				modulesOnly: true,
				preferBuiltins: true,
			}),
			...(isLocal
				? [
						basicSsl({
							/** name of certification */
							name: 'CFODPA Local',
							/** custom trust domains */
							domains: ['localhost'],
							/** custom certification directory */
							certDir: 'tmp',
						}),
					]
				: []),
		],
		server: {
			headers: {
				// Don't cache the server response in dev mode
				'Cache-Control': 'public, max-age=0',
			},
		},
		preview: {
			headers: {
				// Do cache the server response in preview (non-adapter production build)
				'Cache-Control': 'public, max-age=600',
			},
		},
		build: {
			target: 'esnext',
			sourcemap: true,
			emptyOutDir: true,
			rollupOptions: {
				external: [],
			},
			manifest: true,
		},
		worker: {
			rollupOptions: {
				external: [],
			},
		},
		ssr: {
			external: [],
		},
		// This tells Vite which dependencies to pre-build in dev mode.
		optimizeDeps: {
			include: [],
			// Put problematic deps that break bundling here, mostly those with binaries.
			// For example ['better-sqlite3'] if you use that in server functions.
			exclude: [],
		},
	};
});
