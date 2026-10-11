import { component$ } from '@builder.io/qwik';
import { useDocumentHead, useLocation } from '@builder.io/qwik-city';

// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore this gets generated automatically later in the build process
import * as m from '~/paraglide/messages';

const APP_NAME = 'Cloudflare One DNS Privacy AdBlock';
const APP_SHORT_NAME = 'CFODPA';

/**
 * The RouterHead component is placed inside of the document `<head>` element.
 */
export const RouterHead = component$(() => {
	const head = useDocumentHead();
	const loc = useLocation();

	return (
		<>
			<title>{head.title ? `${head.title} | ${APP_SHORT_NAME}` : APP_NAME}</title>

			<link rel="canonical" href={loc.url.href} />
			<meta name="viewport" content="width=device-width, initial-scale=1.0" />
			<meta name="application-name" content={APP_SHORT_NAME} />
			<meta name="description" content={m.app_description()} />
			<link rel="icon" type="image/svg+xml" href="/cfodpa.svg" />

			{head.meta.map((meta) => (
				<meta key={meta.key} {...meta} />
			))}

			{head.links.map((l) => (
				<link key={l.key} {...l} />
			))}

			{head.styles.map((s) => (
				<style key={s.key} {...s.props} {...(s.props?.dangerouslySetInnerHTML ? {} : { dangerouslySetInnerHTML: s.style })} />
			))}

			{head.scripts.map((s) => (
				<script key={s.key} {...s.props} {...(s.props?.dangerouslySetInnerHTML ? {} : { dangerouslySetInnerHTML: s.script })} />
			))}
		</>
	);
});
