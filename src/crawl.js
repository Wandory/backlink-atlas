/*
 * Building the index without ever holding the whole site in hand.
 *
 * A Forge function gets 25 seconds. A Confluence site can hold a hundred
 * thousand pages. So a sweep is not a loop — it is a chain of small steps, each
 * one picking up at the cursor the last one left and queueing the next.
 *
 * The sweep has two phases, and it needs both:
 *
 *   pages    read pages, store each one and the links on it. Links cannot be
 *            judged yet: page 3 may link to page 900, which has not been read.
 *   resolve  now that every page is known, decide what each link actually is.
 *
 * Every dependency is injected. The state machine is therefore testable in full
 * against a fake site, which is the only honest way to know that a crawler
 * which normally runs at three in the morning actually works.
 */

import { extractLinks, extractHeadings, dedupe } from './links.js';
import { edgeKey, edgeRow, pageRow, fold, int, PROBLEM_STATES } from './graph.js';
import { resolveEdge, indexOf } from './resolve.js';

/** The states a reader is shown as problems. */
const PROBLEMS = new Set(PROBLEM_STATES);

/** A fresh sweep, before any step has run. */
export function newSweep(now = 0) {
  return {
    phase: 'pages',
    cursor: null,
    startedAt: int(now),
    finishedAt: 0,
    pages: 0,
    edges: 0,
    problems: 0,
    steps: 0,
    error: '',
  };
}

/** How many pages one step takes on. Bounded by the 25 seconds a step gets. */
export const PAGES_PER_STEP = 40;
export const RESOLVE_PER_STEP = 40;

/**
 * A page as the app stores it, plus its links, from one page of the API.
 * Pure: give it a page and it tells you the rows to write.
 */
export function readPage(page, { baseUrl = '', now = 0 } = {}) {
  const storage = page?.body?.storage?.value ?? page?.body?.value ?? '';
  const links = dedupe(extractLinks(storage, { baseUrl }));
  const headings = extractHeadings(storage);

  const source = {
    id: String(page.id),
    spaceKey: page.spaceKey,
    title: page.title,
  };

  const edges = links.map((link) => ({
    key: edgeKey(source.id, link),
    row: edgeRow({ source, link, state: 'new', at: now }),
  }));

  return {
    id: source.id,
    row: pageRow({
      spaceKey: page.spaceKey,
      title: page.title,
      version: page.version,
      anchors: headings,
      // Reset on every sweep; the resolve phase counts them back up.
      inCount: 0,
      outCount: edges.length,
      brokenCount: 0,
      at: now,
    }),
    edges,
  };
}

/**
 * One step of the pages phase: read a page of pages, store what is on them.
 * Returns the cursor to continue from, or null when there are no more.
 */
export async function pagesStep(state, deps) {
  const { items, cursor } = await deps.fetchPages({
    cursor: state.cursor,
    limit: PAGES_PER_STEP,
  });

  let edges = 0;
  for (const page of items) {
    const read = readPage(page, { baseUrl: deps.baseUrl, now: deps.now() });
    await deps.savePage(read.id, read.row);
    await deps.replaceEdges(read.id, read.edges);
    edges += read.edges.length;
  }

  return {
    ...state,
    cursor: cursor ?? null,
    pages: state.pages + items.length,
    edges: state.edges + edges,
    steps: state.steps + 1,
    // No cursor means every page has been read; the links can now be judged.
    phase: cursor ? 'pages' : 'resolve',
    ...(cursor ? {} : { cursor: null }),
  };
}

/**
 * Look pages up, remembering answers.
 *
 * Storage allows a few thousand reads a minute, and the links on a set of
 * pages point at the same handful of targets over and over — a runbook linked
 * from ninety places is ninety identical questions. Memoising turns them into
 * one. The cache lives for a single step, so it can never go stale.
 */
export function memoLookup(deps) {
  const ids = new Map();
  const titles = new Map();
  return {
    async byId(id) {
      const key = String(id);
      if (!ids.has(key)) ids.set(key, await deps.loadPage(key));
      return ids.get(key);
    },
    async byTitle(spaceFold, titleFold) {
      const key = `${spaceFold}:${titleFold}`;
      if (!titles.has(key)) titles.set(key, await deps.findByTitle(spaceFold, titleFold));
      return titles.get(key);
    },
  };
}

/**
 * Resolve every edge belonging to one page.
 *
 * Returns the state changes to write and how many incoming links each target
 * gained, so the caller can apply them in one batch rather than one at a time.
 */
export async function resolvePageEdges(pageId, lookup, deps) {
  const sourcePage = await lookup.byId(pageId);
  const edges = await deps.loadEdges(pageId);

  const updates = [];
  // Targets this page reaches, each counted once however many links reach it.
  // "Linked from 3 pages" is what a reader means; a page that links to the
  // runbook plainly and again at a heading has not made it twice as reachable.
  const reached = new Set();
  let problems = 0;

  for (const edge of edges) {
    // resolveEdge is synchronous and takes a synchronous lookup, so the two
    // answers it may need are fetched first.
    const view = await viewFor(edge, lookup);
    const verdict = resolveEdge(edge, view, { sourcePage });

    if (verdict.state !== edge.state) {
      updates.push({ key: edge.key, state: verdict.state, reason: verdict.reason });
    }
    // A page does not count as linking to itself.
    if (verdict.targetId && String(verdict.targetId) !== String(pageId)) {
      reached.add(String(verdict.targetId));
    }
    if (PROBLEMS.has(verdict.state)) problems += 1;
  }

  const incoming = new Map([...reached].map((id) => [id, 1]));
  return { updates, incoming, problems, total: edges.length };
}

/** The synchronous view of the index that one edge needs to be judged. */
async function viewFor(edge, lookup) {
  const ref = String(edge.targetRef ?? '');
  const pages = [];

  if (ref.startsWith('id:')) {
    const page = await lookup.byId(ref.slice(3));
    if (page) pages.push(page);
  } else if (ref.startsWith('ttl:')) {
    const rest = ref.slice(4);
    const cut = rest.indexOf(':');
    const space = cut < 0 ? '' : rest.slice(0, cut);
    const title = cut < 0 ? rest : rest.slice(cut + 1);
    pages.push(...(await lookup.byTitle(space, title)));
  }

  const index = indexOf(pages);
  return index;
}

/** One step of the resolve phase. */
export async function resolveStep(state, deps) {
  const { items, cursor } = await deps.fetchIndexedPages({
    cursor: state.cursor,
    limit: RESOLVE_PER_STEP,
  });

  const lookup = memoLookup(deps);
  const incoming = new Map();
  let problems = 0;

  for (const page of items) {
    const result = await resolvePageEdges(page.id, lookup, deps);
    if (result.updates.length) await deps.saveEdgeStates(result.updates);
    if (result.problems) await deps.setPageProblems(page.id, result.problems);
    problems += result.problems;
    for (const [id, n] of result.incoming) {
      incoming.set(id, (incoming.get(id) ?? 0) + n);
    }
  }

  if (incoming.size) await deps.addIncoming([...incoming.entries()]);

  const done = !cursor;
  return {
    ...state,
    cursor: cursor ?? null,
    steps: state.steps + 1,
    problems: state.problems + problems,
    phase: done ? 'done' : 'resolve',
    finishedAt: done ? int(deps.now()) : 0,
  };
}

/**
 * Advance the sweep by one step, whatever phase it is in.
 *
 * A failure is recorded on the sweep rather than thrown away: an index that
 * stopped halfway through the night must say so, because a report built on it
 * is incomplete and a reader has no other way to know.
 */
export async function sweepStep(state, deps) {
  try {
    if (state.phase === 'pages') return await pagesStep(state, deps);
    if (state.phase === 'resolve') return await resolveStep(state, deps);
    return { ...state, phase: 'done' };
  } catch (error) {
    return {
      ...state,
      phase: 'failed',
      steps: state.steps + 1,
      error: String(error?.message ?? error).slice(0, 300),
      finishedAt: int(deps.now()),
    };
  }
}

/** Whether the sweep wants another step queued. */
export function isRunning(state) {
  return state.phase === 'pages' || state.phase === 'resolve';
}

/**
 * A single page changed, so only that page is re-read.
 *
 * This is what keeps the index fresh between sweeps, and it is deliberately
 * asymmetric: editing a page changes what that page points at, which this
 * fixes immediately. It can also break links on other pages that pointed at
 * its old title, and those are not found until the next sweep. The reports say
 * when the last sweep ran, so a reader can tell how fresh the answer is.
 */
export async function reindexOne(page, deps) {
  const read = readPage(page, { baseUrl: deps.baseUrl, now: deps.now() });
  await deps.savePage(read.id, read.row);
  await deps.replaceEdges(read.id, read.edges);

  const lookup = memoLookup(deps);
  const result = await resolvePageEdges(read.id, lookup, deps);
  if (result.updates.length) await deps.saveEdgeStates(result.updates);
  if (result.problems) await deps.setPageProblems(read.id, result.problems);
  return { id: read.id, edges: read.edges.length, problems: result.problems };
}

/** A page was deleted: it points at nothing now, and nothing should claim it does. */
export async function forgetPage(pageId, deps) {
  await deps.replaceEdges(String(pageId), []);
  await deps.deletePage(String(pageId));
}

/** Space keys fold the same way everywhere, so report filters match storage. */
export const spaceOf = (value) => fold(value) || 'unknown';
