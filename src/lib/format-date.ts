/** Server-side date rendering with the request's negotiated locale and the Cloudflare-detected timezone (see `useLocale`/`useTimezone` in `~/routes/layout.tsx`), so SSR output and the user's clock agree without any client-side hydration. */
export function formatDateTime(iso: string | undefined, locale: string, timeZone: string | undefined) {
	if (!iso) return undefined;
	const date = new Date(iso);
	if (Number.isNaN(date.getTime())) return undefined;

	try {
		return new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short', timeZone }).format(date);
	} catch {
		// An unknown/garbled timezone from the edge must never take the page down - fall back to the runtime default.
		return new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }).format(date);
	}
}
