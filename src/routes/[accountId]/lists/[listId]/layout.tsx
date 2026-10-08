import type { RequestHandler } from '@builder.io/qwik-city';
import * as zm from 'zod/mini';

/** Cloudflare list IDs are UUIDv4 - anything else is bounced back to the table before any API call is made with it. */
export const onRequest: RequestHandler = ({ params, redirect }) => {
	const validListId = zm.safeParse(zm.uuidv4(), params['listId']?.trim().toLowerCase()).success;
	if (!validListId) throw redirect(302, `/${params['accountId']}/`);
};
