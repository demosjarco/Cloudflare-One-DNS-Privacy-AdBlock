import { component$, noSerialize, Resource, useResource$, useSignal, useVisibleTask$, type NoSerialize } from '@builder.io/qwik';
import { server$ } from '@builder.io/qwik-city';
import * as zm from 'zod/mini';
import { getCloudflareAccessToken } from '~/lib/auth/cloudflare-token';
import { LIST_ITEMS_PER_PAGE, listManagedListItemsPage, type ManagedList } from '~/lib/gateway/lists';

// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore this gets generated automatically later in the build process
import * as m from '~/paraglide/messages';

/** Same shapes the route guards enforce on `accountId`/`listId` (see the two `layout.tsx` `onRequest`s); `page` is bounded by the largest list the API allows divided by the page size, with headroom for raised Enterprise caps. */
const pageRequestSchema = zm.object({
	accountId: zm.hex().check(zm.trim(), zm.length(32)),
	listId: zm.uuidv4(),
	page: zm.int().check(zm.gte(1), zm.lte(100)),
});

export interface ListItemsPage {
	/** Hostnames only - the item objects' other fields (`created_at`, per-item description) aren't shown, so they don't cross the wire. */
	hostnames: string[];
	failed: boolean;
}

/**
 * Called from the browser when a page segment scrolls into view, and only then. `this` is the request event, so the token comes from the session cookie exactly as it does for actions; the arguments arrive from the client and are validated before use. One page in, one page out - the Worker holds a single page's worth for the life of this call and keeps nothing.
 * Callers may pass an `AbortSignal` ahead of these arguments (qwik-city's `ServerQRL` convention) to cancel the underlying fetch.
 */
export const fetchListItemsPage = server$(async function (accountId: string, listId: string, page: number): Promise<ListItemsPage> {
	const parsed = zm.safeParse(pageRequestSchema, { accountId, listId, page });
	if (!parsed.success) return { hostnames: [], failed: true };

	const apiToken = await getCloudflareAccessToken(this);
	if (!apiToken) return { hostnames: [], failed: true };

	const result = await listManagedListItemsPage(apiToken, parsed.data.accountId, parsed.data.listId.toLowerCase(), parsed.data.page, (this.platform.request ?? this.request).signal);
	return { hostnames: result.items.map((item) => item.value).filter((value) => value !== undefined), failed: result.failed };
});

const TH = 'text-kumo-subtle px-3 py-2 text-xs font-medium tracking-wide uppercase';
const TD_INDEX = 'text-kumo-subtle px-3 py-1.5 text-right font-mono text-xs tabular-nums';
const TD_HOST = 'text-kumo-default px-3 py-1.5 font-mono text-sm break-all';
const NOTE_ROW = 'px-3 py-4 text-center text-sm';

/** What one hostname row measures at the default font size - measured live (2026-10-11): a 1,000-row segment is 29,000px. Only used to size a segment's placeholder before its rows exist, so the scrollbar is honest and the next segment sits where it will end up; the real rows replace the estimate once loaded. */
const ROW_HEIGHT_PX = 29;

interface PageSegmentProps {
	accountId: string;
	listId: string;
	page: number;
	/** 1-based entry number of the segment's first row across the whole source, for the row numbers. */
	from: number;
	/** Rows this segment will hold once loaded - sizes the placeholder. */
	rows: number;
}

function noteRow(tone: 'text-kumo-subtle' | 'text-kumo-danger', text: string) {
	return (
		<tr>
			<td colSpan={2} class={[tone, NOTE_ROW]}>
				{text}
			</td>
		</tr>
	);
}

/**
 * The segment's stand-in while it has no rows: one cell as tall as the rows will be. Used both before the segment is ever seen and while its page is loading - the loading state must keep this height, because if it shrank to a one-line note the segment below would slide into the viewport, start loading, shrink, and so on down the table (observed live: eighteen segments in flight from a single scroll into view).
 */
function placeholderRow(rows: number, text?: string) {
	return (
		<tr>
			<td colSpan={2} class={['text-kumo-subtle px-3 py-4 text-center align-top text-sm']} style={{ height: `${rows * ROW_HEIGHT_PX}px` }}>
				{text}
			</td>
		</tr>
	);
}

/**
 * One API page of one Cloudflare list as a `<tbody>` in the shared table, in two parts:
 *
 * - `useVisibleTask$` (default intersection strategy, so Qwik runs it the first time the segment scrolls into view and never before) flips a write-once `seen` flag, and owns the `AbortController`: its `cleanup` - which Qwik calls when it unloads the component - aborts, so a fetch still in flight at that point is cancelled rather than finished for nobody.
 * - `useResource$` tracks `seen`. While false (every segment on the server, and every segment nobody has scrolled to) it resolves to `null`, which `onResolved` renders as the empty placeholder row of the right height, so the scrollbar and the row numbers below are honest from the start; `onPending` is the same placeholder with a loading note, never shorter (see {@link placeholderRow}). Once true it makes the one request for this page, with the visible task's signal ahead of the arguments (qwik-city's `ServerQRL` convention - the Worker side already runs under the incoming request's own signal).
 */
const PageSegment = component$<PageSegmentProps>(({ accountId, listId, page, from, rows }) => {
	const seen = useSignal(false);
	const abort = useSignal<NoSerialize<AbortController>>();

	// eslint-disable-next-line qwik/no-use-visible-task
	useVisibleTask$((task) => {
		const controller = new AbortController();
		task.cleanup(() => controller.abort());
		abort.value = noSerialize(controller);
		seen.value = true;
	});

	const items = useResource$<ListItemsPage | null>(({ track }) => {
		if (!track(seen)) return Promise.resolve(null);
		const signal = abort.value?.signal;
		return signal ? fetchListItemsPage(signal, accountId, listId, page) : fetchListItemsPage(accountId, listId, page);
	});

	return (
		<tbody class="divide-kumo-line divide-y">
			<Resource
				value={items}
				onPending={() => placeholderRow(rows, m.lists_detail_page_loading())}
				onRejected={() => noteRow('text-kumo-danger', m.lists_load_error())}
				onResolved={(result) => {
					if (result === null) return placeholderRow(rows);
					if (result.failed) return noteRow('text-kumo-danger', m.lists_load_error());
					if (result.hostnames.length === 0) return noteRow('text-kumo-subtle', m.lists_detail_no_entries());

					return (
						<>
							{result.hostnames.map((hostname, index) => (
								<tr key={hostname}>
									<td class={TD_INDEX}>{(from + index).toLocaleString()}</td>
									<td class={TD_HOST}>{hostname}</td>
								</tr>
							))}
						</>
					);
				}}
			/>
		</tbody>
	);
});

export interface ListEntriesTableProps {
	accountId: string;
	/** The source's Cloudflare lists in `part` order. */
	chunks: ManagedList[];
}

/** Width of the row-number column, shared by the column header and every table so they line up as one. */
const INDEX_COL = '4rem';

/**
 * Every entry of a source as one continuous, continuously-numbered table, however many Cloudflare lists it spans. Each Cloudflare list is its own block - a sticky header ("Part 2 of 15: ...") over a table of that list's page segments (see {@link PageSegment}) - because `position: sticky` can't leave its container: a header that is a row of a shared table would be pinned by its own `<tbody>`, while a header above its own block sticks for exactly as long as that block is on screen and is pushed out by the next one. The blocks read as one table because every table is `table-fixed` with the same column widths. Page counts come from each list record's `count`, so no request is made just to find out where the entries end.
 */
export const ListEntriesTable = component$<ListEntriesTableProps>(({ accountId, chunks }) => {
	let offset = 0;

	return (
		<div>
			<div class="border-kumo-line grid border-b" style={{ gridTemplateColumns: `${INDEX_COL} 1fr` }}>
				<div class={[TH, 'text-right']}>#</div>
				<div class={[TH, 'text-left']}>{m.lists_col_hostname()}</div>
			</div>
			{chunks.map((chunk, index) => {
				// `undefined` (Cloudflare didn't report a count) is not zero: one segment is offered so the entries can still be looked at, and the header says the count is unknown rather than claiming "0".
				const count = chunk.count;
				const pages = count === undefined ? 1 : Math.ceil(count / LIST_ITEMS_PER_PAGE);
				const chunkOffset = offset;
				offset += count ?? 0;

				return (
					<div key={chunk.id}>
						<div class="border-kumo-line bg-kumo-tint text-kumo-subtle sticky top-0 z-10 border-y px-3 py-1 text-xs">{m.lists_detail_chunk_heading({ part: (index + 1).toLocaleString(), parts: chunks.length.toLocaleString(), name: chunk.name, count: count?.toLocaleString() ?? '–' })}</div>
						{count === 0 ? (
							<p class={['text-kumo-subtle', NOTE_ROW]}>{m.lists_detail_no_entries()}</p>
						) : (
							<table class="w-full table-fixed border-collapse">
								<colgroup>
									<col style={{ width: INDEX_COL }} />
									<col />
								</colgroup>
								{Array.from({ length: pages }, (_, pageIndex) => {
									const pageStart = pageIndex * LIST_ITEMS_PER_PAGE;
									const rows = count === undefined ? LIST_ITEMS_PER_PAGE : Math.min(LIST_ITEMS_PER_PAGE, count - pageStart);
									return <PageSegment key={`${chunk.id}:${pageIndex}`} accountId={accountId} listId={chunk.id} page={pageIndex + 1} from={chunkOffset + pageStart + 1} rows={rows} />;
								})}
							</table>
						)}
					</div>
				);
			})}
		</div>
	);
});
