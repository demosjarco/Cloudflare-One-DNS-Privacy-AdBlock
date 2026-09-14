import { renderToStream, type RenderToStreamOptions } from '@builder.io/qwik/server';
import { manifest } from '@qwik-client-manifest';
import Root from './root';
import { parseThemePreferenceFromCookieHeader } from './components/theme-toggle/theme-shared';

export default function (opts: RenderToStreamOptions) {
	// Rendering `data-mode` server-side for an explicit light/dark choice means the client-side sync script
	// (src/root.tsx) only has to handle the "system" case - no flash either way.
	const themePreference = parseThemePreferenceFromCookieHeader((opts.serverData?.['requestHeaders'] as Record<string, string> | undefined)?.['cookie']);

	return renderToStream(<Root />, {
		manifest,
		...opts,
		// Use container attributes to set attributes on the html tag.
		containerAttributes: {
			lang: (opts.serverData?.['locale'] as string | undefined) ?? 'en-us',
			'data-theme-preference': themePreference,
			...(themePreference === 'system' ? {} : { 'data-mode': themePreference }),
			...opts.containerAttributes,
		},
	});
}
