/*
 * The app itself: what Forge calls, and what it calls in turn.
 *
 * Nothing here decides anything. Every judgement lives in links.js, graph.js,
 * resolve.js and crawl.js, which are pure and tested. This file is wiring —
 * fetching, storing, queueing and authorising — and it is kept thin on purpose,
 * because it is the part that cannot be tested without the platform.
 */

import api, { route } from '@forge/api';
import { kvs } from '@forge/kvs';
import { Queue } from '@forge/events';
import ResolverModule from '@forge/resolver';

import {
  newSweep, sweepStep, isRunning, reindexOne, forgetPage, PAGES_PER_STEP,
} from './crawl.js';
import { refsForPage, fold, PROBLEM_STATES, STATES } from './graph.js';
import * as store from './store.js';
import { filterBySource, isSiteAdmin, requireAdmin, visiblePages } from './authz.js';

// @forge/resolver ships as CommonJS; under ESM the constructor arrives on
// `.default`. Reading it either way keeps the app working across both.
const Resolver = typeof ResolverModule === 'function' ? ResolverModule : ResolverModule.default;

const SWEEP = 'sweep';
const SITE = 'site';
const crawlQueue = new Queue({ key: 'crawl' });

/* ----------------------------- Confluence ------------------------------- */

const asApp = () => api.asApp();

/**
 * Space ids to space keys.
 *
 * The v2 API names a page's space by id, and every report, filter and stored
 * row in this app is keyed by the space *key* a person recognises. The map is
 * small — a site has tens or hundreds of spaces, not millions — and is fetched
 * once per invocation.
 */
async function spaceKeys() {
  const byId = new Map();
  let cursor;
  for (let page = 0; page < 40; page += 1) {
    const url = cursor
      ? route`/wiki/api/v2/spaces?limit=250&cursor=${cursor}`
      : route`/wiki/api/v2/spaces?limit=250`;
    const response = await asApp().requestConfluence(url, { headers: { Accept: 'application/json' } });
    if (!response.ok) break;
    const body = await response.json();
    for (const space of body?.results ?? []) byId.set(String(space.id), space.key);
    cursor = nextCursor(body);
    if (!cursor) break;
  }
  return byId;
}

/** v2 paginates with an opaque cursor inside a relative `next` link. */
function nextCursor(body) {
  const next = body?._links?.next;
  if (!next) return null;
  const match = /[?&]cursor=([^&]+)/.exec(next);
  return match ? decodeURIComponent(match[1]) : null;
}

/** Where this site lives, remembered so the crawler can recognise its own URLs. */
async function siteInfo() {
  return (await kvs.get(SITE)) ?? {};
}

async function rememberSite(context) {
  const url = context?.siteUrl;
  if (!url) return;
  const known = await siteInfo();
  if (known.baseUrl === url) return;
  await kvs.set(SITE, { ...known, baseUrl: url });
}

/* ------------------------- the crawler's world -------------------------- */

/**
 * Everything crawl.js needs, bound to the real platform.
 *
 * `spaces` is passed in rather than fetched per page so that one step makes one
 * call for it instead of forty.
 */
function crawlDeps({ spaces, baseUrl }) {
  return {
    baseUrl,
    now: () => Math.floor(Date.now() / 1000),

    async fetchPages({ cursor, limit }) {
      const size = Math.min(limit ?? PAGES_PER_STEP, 250);
      const url = cursor
        ? route`/wiki/api/v2/pages?body-format=storage&status=current&limit=${String(size)}&cursor=${cursor}`
        : route`/wiki/api/v2/pages?body-format=storage&status=current&limit=${String(size)}`;
      const response = await asApp().requestConfluence(url, { headers: { Accept: 'application/json' } });
      if (!response.ok) {
        throw new Error(`Confluence returned ${response.status} listing pages`);
      }
      const body = await response.json();
      return {
        items: (body?.results ?? []).map((page) => ({
          id: String(page.id),
          title: page.title,
          spaceKey: spaces.get(String(page.spaceId)) ?? 'unknown',
          version: page?.version?.number ?? 0,
          body: page.body,
        })),
        cursor: nextCursor(body),
      };
    },

    async fetchIndexedPages({ cursor, limit }) {
      // The resolve phase walks what was just indexed, not Confluence again.
      const from = cursor ? JSON.parse(cursor) : { spaceIndex: 0, inner: null };
      const keys = [...new Set([...spaces.values()].map(fold))].sort();
      let { spaceIndex, inner } = from;

      while (spaceIndex < keys.length) {
        const page = await store.listSpacePages(keys[spaceIndex], { cursor: inner, limit });
        if (page.items.length) {
          const nextInner = page.cursor;
          const nextState = nextInner
            ? { spaceIndex, inner: nextInner }
            : { spaceIndex: spaceIndex + 1, inner: null };
          const more = nextState.spaceIndex < keys.length || nextInner;
          return { items: page.items, cursor: more ? JSON.stringify(nextState) : null };
        }
        spaceIndex += 1;
        inner = null;
      }
      return { items: [], cursor: null };
    },

    savePage: store.savePage,
    loadPage: store.loadPage,
    deletePage: store.deletePage,
    findByTitle: store.findByTitle,
    replaceEdges: store.replaceEdges,
    loadEdges: store.loadEdges,
    saveEdgeStates: store.saveEdgeStates,
    setPageProblems: store.setPageProblems,
    addIncoming: store.addIncoming,
  };
}

async function deps() {
  const [spaces, site] = await Promise.all([spaceKeys(), siteInfo()]);
  return crawlDeps({ spaces, baseUrl: site.baseUrl ?? '' });
}

/* ------------------------------ the sweep ------------------------------- */

async function loadSweep() {
  return (await kvs.get(SWEEP)) ?? { ...newSweep(0), phase: 'never' };
}

async function beginSweep() {
  const state = newSweep(Math.floor(Date.now() / 1000));
  await kvs.set(SWEEP, state);
  await crawlQueue.push({ reason: 'start' });
  return state;
}

/** One queued step, which queues the next while there is more to do. */
export const crawlStep = (() => {
  const resolver = new Resolver();
  resolver.define('step', async () => {
    const state = await loadSweep();
    if (!isRunning(state)) return { done: true };

    const next = await sweepStep(state, await deps());
    await kvs.set(SWEEP, next);

    if (isRunning(next)) await crawlQueue.push({ reason: 'continue' });
    return { phase: next.phase, pages: next.pages };
  });
  return resolver.getDefinitions();
})();

/** The nightly sweep. Skipped if one is already running. */
export async function startSweep() {
  const state = await loadSweep();
  if (isRunning(state)) return { skipped: 'a sweep is already running' };
  return beginSweep();
}

/* ------------------------------- triggers ------------------------------- */

/**
 * A page was created, edited or deleted.
 *
 * Only that page is re-read. What this cannot catch is the other half: renaming
 * a page can break links on pages that named it by its old title, and those are
 * only found by the next sweep. Every report says when the last sweep finished,
 * so a reader can judge how fresh the answer is rather than being told a
 * comforting nothing.
 */
export async function onPageEvent(event) {
  const id = event?.content?.id ?? event?.page?.id;
  if (!id) return { ignored: 'no page id on the event' };

  if (event?.eventType?.includes('removed')) {
    await forgetPage(id, await deps());
    return { forgotten: String(id) };
  }

  const bound = await deps();
  const response = await asApp().requestConfluence(
    route`/wiki/api/v2/pages/${String(id)}?body-format=storage`,
    { headers: { Accept: 'application/json' } },
  );
  if (!response.ok) return { skipped: `Confluence returned ${response.status}` };

  const page = await response.json();
  const spaces = await spaceKeys();
  return reindexOne({
    id: String(page.id),
    title: page.title,
    spaceKey: spaces.get(String(page.spaceId)) ?? 'unknown',
    version: page?.version?.number ?? 0,
    body: page.body,
  }, bound);
}

/* ------------------------------ the reports ----------------------------- */

/**
 * What links to a page.
 *
 * The index is read with the app's permissions and then cut down to what the
 * person asking may see, by asking Confluence rather than by guessing. The
 * number of rows removed is reported instead of hidden.
 */
async function backlinksFor({ pageId, spaceKey, title }) {
  if (!pageId) return { rows: [], withheld: 0, total: 0 };

  const page = await store.loadPage(pageId);
  const refs = refsForPage({
    id: pageId,
    spaceKey: spaceKey ?? page?.spaceKey,
    title: title ?? page?.title,
  });

  const { rows, truncated } = await store.edgesPointingAt(refs);
  const { rows: allowed, withheld } = await filterBySource(rows);

  // One row per source page: a page that links here three times is one entry.
  const bySource = new Map();
  for (const row of allowed) {
    const seen = bySource.get(row.sourceId);
    if (!seen) { bySource.set(row.sourceId, { ...row, anchors: [row.anchor].filter(Boolean) }); continue; }
    if (row.anchor && !seen.anchors.includes(row.anchor)) seen.anchors.push(row.anchor);
    seen.hits = (seen.hits ?? 1) + (row.hits ?? 1);
  }

  return {
    rows: [...bySource.values()].sort((a, b) =>
      String(a.sourceTitle ?? '').localeCompare(String(b.sourceTitle ?? ''))),
    withheld,
    total: rows.length,
    truncated,
  };
}

/** The link health of one space. */
async function spaceReport({ spaceKey }) {
  const space = fold(spaceKey);
  if (!space) return { error: 'No space was given.' };

  const found = [];
  for (const state of PROBLEM_STATES) {
    const { rows } = await store.edgesInState(space, state, { max: 200 });
    for (const row of rows) found.push({ ...row, meaning: STATES[state] });
  }

  const { rows: visible, withheld } = await filterBySource(found);
  const { items: orphans, truncated } = await store.orphansIn(space);
  const orphanIds = orphans.map((o) => o.id);
  const orphansVisible = await visiblePages(orphanIds);

  return {
    problems: visible,
    withheld,
    orphans: orphans
      .filter((o) => orphansVisible.has(String(o.id)))
      .map((o) => ({ id: o.id, title: o.title, spaceKey: o.spaceKey })),
    orphansTruncated: truncated,
    sweep: await loadSweep(),
  };
}

/* ------------------------------ resolvers ------------------------------- */

const resolver = new Resolver();

resolver.define('backlinks', async ({ payload, context }) => {
  await rememberSite(context);
  const pageId = payload?.pageId ?? context?.extension?.content?.id;
  return backlinksFor({ pageId, spaceKey: payload?.spaceKey, title: payload?.title });
});

resolver.define('spaceReport', async ({ payload, context }) => {
  await rememberSite(context);
  const key = payload?.spaceKey ?? context?.extension?.space?.key;
  return spaceReport({ spaceKey: key });
});

resolver.define('status', async ({ context }) => {
  await rememberSite(context);
  const sweep = await loadSweep();
  return { sweep, admin: await isSiteAdmin() };
});

// Only these two cost the site something, so only these two are gated.
resolver.define('runSweep', requireAdmin(isSiteAdmin, async () => beginSweep()));

resolver.define('stopSweep', requireAdmin(isSiteAdmin, async () => {
  const state = await loadSweep();
  const stopped = { ...state, phase: 'stopped', finishedAt: Math.floor(Date.now() / 1000) };
  await kvs.set(SWEEP, stopped);
  return stopped;
}));

export const handler = resolver.getDefinitions();

/**
 * The count shown in the page byline, without opening anything.
 *
 * Deliberately the same permission-filtered number the panel shows, so the
 * byline never advertises a page the reader may not open.
 */
export const byline = (() => {
  const bylineResolver = new Resolver();
  bylineResolver.define('byline', async ({ context }) => {
    const pageId = context?.extension?.content?.id;
    const { rows, withheld } = await backlinksFor({ pageId });
    const n = rows.length;
    return {
      title: n === 0 ? 'No backlinks' : `${n} backlink${n === 1 ? '' : 's'}`,
      tooltip: withheld
        ? `${n} pages you can see link here. ${withheld} more do, which you do not have access to.`
        : 'Pages that link to this one.',
    };
  });
  return bylineResolver.getDefinitions();
})();
