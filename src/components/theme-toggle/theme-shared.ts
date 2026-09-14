import * as zm from 'zod/mini';

export const THEME_COOKIE_NAME = 'theme-mode';

/** Shared with `~/routes/layout.tsx`'s `useThemePreference` loader, which reads the same cookie via the `cookie` request-event helper instead of this raw-header parse - that's only needed here because entry.ssr.tsx renders outside the route/loader system entirely (it's what calls `renderToStream`), so it has no loader to read from. */
export const themePreferenceSchema = zm.catch(zm.enum(['light', 'dark', 'system']), 'system');

/** For entry.ssr.tsx's `containerAttributes` only - see the note on `themePreferenceSchema`. */
export function parseThemePreferenceFromCookieHeader(cookieHeader: string | null | undefined) {
	if (!cookieHeader) return 'system';

	for (const part of cookieHeader.split(';')) {
		const separatorIndex = part.indexOf('=');
		if (separatorIndex === -1) continue;

		const name = part.slice(0, separatorIndex).trim();
		if (name !== THEME_COOKIE_NAME) continue;

		return themePreferenceSchema.parse(decodeURIComponent(part.slice(separatorIndex + 1).trim()));
	}

	return 'system';
}
