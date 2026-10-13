/**
 * Identifiers Workers Issues shows alongside an occurrence ("who experienced it"). Never put tokens or other secrets here.
 * Goes through `ctx.tracing` rather than `import { tracing } from 'cloudflare:workers'` - `npm run dev` runs SSR in Node (not workerd), where that specifier doesn't resolve. Under the dev `getPlatformProxy` ctx there's no `tracing`, so this is a no-op there.
 * @link https://developers.cloudflare.com/workers/observability/issues/investigate/#add-application-context
 * @link https://developers.cloudflare.com/workers/runtime-apis/context/#tracing
 */
export function setIssueContext(platform: QwikCityPlatform, context: Partial<{ userId: string; sessionId: string; accountId: string }>) {
	(platform.ctx as Partial<Pick<ExecutionContext, 'tracing'>>).tracing?.getActiveSpan()?.setAttributes({
		'user.id': context.userId,
		'session.id': context.sessionId,
		// The Issues docs sample uses `account.id`; `tenant.id` is kept too as the generic name - set both so whichever one Issues keys off is populated.
		'tenant.id': context.accountId,
		'account.id': context.accountId,
	});
}
