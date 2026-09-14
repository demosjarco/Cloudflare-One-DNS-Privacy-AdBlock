import type { RequestHandler } from '@builder.io/qwik-city';
import * as zm from 'zod/mini';

export const onRequest: RequestHandler = ({ params, redirect }) => {
	const validAccountId = zm.validate(
		/**
		 * @link https://developers.cloudflare.com/api/resources/accounts/#(resource)%20accounts%20%3E%20(model)%20account%20%3E%20(schema)
		 */
		zm.hex().check(zm.trim(), zm.length(32)),
		params['accountId'],
	);
	// Not valid account id
	if (!validAccountId) throw redirect(302, '/');
};
