import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  newSweep, sweepStep, isRunning, readPage, reindexOne, forgetPage, memoLookup,
  catchUp,
} from '../src/crawl.js';
import { fold, refsForPage } from '../src/graph.js';

/*
 * A whole Confluence site, small enough to reason about and large enough to
 * force the crawler to take more than one step at every phase.
 *
 *   OPS/Home            links to the runbook, to a page that was deleted,
 *                       and to a heading that has been renamed
 *   OPS/Deploy Runbook  has headings; links off-site
 *   OPS/Incident Log    links to the runbook by id
 *   OPS/Orphan          nothing links to it
 *   ENG/Notes           links across spaces to the OPS runbook
 */
const SITE = [
  {
    id: '1', spaceKey: 'OPS', title: 'Home', version: 3,
    storage:
      '<p><ac:link><ri:page ri:content-title="Deploy Runbook"/></ac:link></p>'
      + '<p><ac:link><ri:page ri:content-title="Retired Policy"/></ac:link></p>'
      + '<p><ac:link ac:anchor="Old Section"><ri:page ri:content-title="Deploy Runbook"/></ac:link></p>'
      + '<p><ac:link><ri:page ri:content-title="Deploy Runbook"/></ac:link></p>',
  },
  {
    id: '2', spaceKey: 'OPS', title: 'Deploy Runbook', version: 9,
    storage:
      '<h2>Rollback steps</h2><p>text</p><h2>On call</h2>'
      + '<p><a href="https://status.example.com/">status page</a></p>'
      + '<ac:structured-macro ac:name="code"><ac:plain-text-body>'
      + '<![CDATA[<a href="/wiki/spaces/OPS/pages/404/Nope">sample</a>]]>'
      + '</ac:plain-text-body></ac:structured-macro>',
  },
  {
    id: '3', spaceKey: 'OPS', title: 'Incident Log', version: 2,
    storage: '<p><ac:link><ri:page ri:content-id="2"/></ac:link></p>',
  },
  { id: '4', spaceKey: 'OPS', title: 'Orphan', version: 1, storage: '<p>nothing here</p>' },
  {
    id: '5', spaceKey: 'ENG', title: 'Notes', version: 1,
    storage: '<ac:link><ri:page ri:content-title="Deploy Runbook" ri:space-key="OPS"/></ac:link>',
  },
];

/** A fake site and a fake store, standing in for Confluence and Forge storage. */
function harness(site = SITE, { pageSize = 2 } = {}) {
  const pages = new Map();   // id -> page row
  const edges = new Map();   // key -> edge row (with .key)
  let recent = [];           // what the newest-edited listing returns
  const calls = { recent: 0 };
  let clock = 1_700_000;
  let reads = 0;

  const asApi = (p) => ({
    id: p.id, spaceKey: p.spaceKey, title: p.title, version: p.version,
    body: { storage: { value: p.storage } },
  });

  const paged = (list, cursor, limit) => {
    const start = cursor ? Number(cursor) : 0;
    const slice = list.slice(start, start + limit);
    const next = start + limit < list.length ? String(start + limit) : null;
    return { items: slice, cursor: next };
  };

  const deps = {
    baseUrl: 'https://acme.atlassian.net',
    now: () => (clock += 1),

    async fetchPages({ cursor, limit }) {
      const { items, cursor: next } = paged(site, cursor, Math.min(limit, pageSize));
      return { items: items.map(asApi), cursor: next };
    },

    async fetchRecentPages({ cursor, limit }) {
      // Newest-edited first is what the real endpoint promises; the harness
      // keeps an explicit order so a test can decide what "recent" means.
      const ordered = recent.length ? recent : [...site].reverse();
      const { items, cursor: next } = paged(ordered, cursor, Math.min(limit, pageSize));
      calls.recent += 1;
      return { items: items.map(asApi), cursor: next };
    },

    async fetchIndexedPages({ cursor, limit }) {
      const all = [...pages.keys()].sort().map((id) => ({ id }));
      return paged(all, cursor, Math.min(limit, pageSize));
    },

    async savePage(id, row) { pages.set(String(id), { ...row, id: String(id) }); },
    async deletePage(id) { pages.delete(String(id)); },

    async loadPage(id) {
      reads += 1;
      return pages.get(String(id)) ?? null;
    },

    async findByTitle(spaceFold, titleFold) {
      reads += 1;
      return [...pages.values()].filter(
        (p) => p.spaceKey === spaceFold && p.titleFold === titleFold);
    },

    async replaceEdges(sourceId, rows) {
      for (const [key, row] of edges) {
        if (row.sourceId === String(sourceId)) edges.delete(key);
      }
      for (const { key, row } of rows) edges.set(key, { ...row, key });
    },

    async loadEdges(sourceId) {
      return [...edges.values()].filter((e) => e.sourceId === String(sourceId));
    },

    async saveEdgeStates(updates) {
      for (const u of updates) {
        const row = edges.get(u.key);
        if (row) edges.set(u.key, { ...row, state: u.state, reason: u.reason });
      }
    },

    async setPageProblems(id, n) {
      const row = pages.get(String(id));
      if (row) pages.set(String(id), { ...row, brokenCount: n });
    },

    async addIncoming(entries) {
      for (const [id, n] of entries) {
        const row = pages.get(String(id));
        if (row) pages.set(String(id), { ...row, inCount: (row.inCount ?? 0) + n });
      }
    },
  };

  const runSweep = async () => {
    let state = newSweep(clock);
    let guard = 0;
    while (isRunning(state)) {
      state = await sweepStep(state, deps);
      if (++guard > 100) throw new Error('sweep did not finish');
    }
    return state;
  };

  const backlinksTo = (page) => {
    const refs = refsForPage(page);
    return [...edges.values()].filter((e) => refs.includes(e.targetRef));
  };

  const setRecent = (list) => { recent = list; };

  return {
    deps, pages, edges, runSweep, backlinksTo, asApi, setRecent, calls,
    reads: () => reads,
  };
}

describe('reading one page', () => {
  test('the links and the headings both come off it', () => {
    const read = readPage(harness().asApi(SITE[1]), { baseUrl: 'https://acme.atlassian.net' });
    assert.equal(read.row.title, 'Deploy Runbook');
    assert.deepEqual(read.row.anchors, ['rollback steps', 'on call']);
    // The off-site status page is a link; the one inside the code macro is not.
    assert.equal(read.edges.length, 1);
    assert.equal(read.edges[0].row.kind, 'url');
  });

  test('a page linked three times is one edge counted three times', () => {
    const read = readPage(harness().asApi(SITE[0]));
    const toRunbook = read.edges.filter((e) => e.row.targetTitle === 'Deploy Runbook');
    // Twice plainly and once with an anchor: the anchored one is its own edge.
    assert.equal(toRunbook.length, 2);
    assert.equal(toRunbook.find((e) => !e.row.anchor).row.hits, 2);
  });

  test('a page row starts each sweep with no incoming links counted', () => {
    assert.equal(readPage(harness().asApi(SITE[0])).row.inCount, 0);
  });
});

describe('a full sweep', () => {
  test('it finishes, in more than one step, and says so', async () => {
    const h = harness();
    const state = await h.runSweep();
    assert.equal(state.phase, 'done');
    assert.equal(state.pages, SITE.length);
    assert.ok(state.steps > 4, `expected several steps, took ${state.steps}`);
    assert.ok(state.finishedAt > 0);
    assert.equal(state.error, '');
  });

  test('every page is indexed', async () => {
    const h = harness();
    await h.runSweep();
    assert.equal(h.pages.size, SITE.length);
    assert.equal(h.pages.get('2').spaceKey, 'ops');
  });

  test('the reverse index answers the question Confluence cannot', async () => {
    const h = harness();
    await h.runSweep();
    const back = h.backlinksTo({ id: '2', spaceKey: 'OPS', title: 'Deploy Runbook' });
    const sources = [...new Set(back.map((e) => e.sourceId))].sort();
    // Home (by title), Incident Log (by id) and ENG/Notes (across spaces).
    assert.deepEqual(sources, ['1', '3', '5']);
  });

  test('a link to a page that does not exist is found and explained', async () => {
    const h = harness();
    await h.runSweep();
    const broken = [...h.edges.values()].filter((e) => e.state === 'missing');
    assert.equal(broken.length, 1);
    assert.equal(broken[0].targetTitle, 'Retired Policy');
    assert.equal(broken[0].sourceId, '1');
    assert.match(broken[0].reason, /renamed, moved or deleted/);
  });

  test('a link to a heading that is gone is found separately from a dead page', async () => {
    const h = harness();
    await h.runSweep();
    const anchors = [...h.edges.values()].filter((e) => e.state === 'anchormissing');
    assert.equal(anchors.length, 1);
    assert.equal(anchors[0].anchor, 'Old Section');
    assert.match(anchors[0].reason, /drops the reader at the top/);
  });

  test('an off-site link is recorded but never called broken', async () => {
    const h = harness();
    await h.runSweep();
    const external = [...h.edges.values()].filter((e) => e.state === 'external');
    assert.equal(external.length, 1);
    assert.match(external[0].targetRef, /^url:https:\/\/status\.example\.com/);
  });

  test('a page linked twice from one page counts as one incoming page', async () => {
    const h = harness();
    await h.runSweep();
    assert.equal(h.pages.get('2').inCount, 3);
    assert.equal(h.pages.get('4').inCount, 0);
  });

  test('the page carrying broken links is the one marked with them', async () => {
    const h = harness();
    await h.runSweep();
    assert.equal(h.pages.get('1').brokenCount, 2); // the dead page and the dead heading
    assert.equal(h.pages.get('2').brokenCount ?? 0, 0);
  });

  test('nothing is left unresolved when the sweep is done', async () => {
    const h = harness();
    await h.runSweep();
    const unresolved = [...h.edges.values()].filter((e) => e.state === 'new');
    assert.deepEqual(unresolved, []);
  });

  test('sweeping twice does not double the counts', async () => {
    const h = harness();
    await h.runSweep();
    const first = h.pages.get('2').inCount;
    await h.runSweep();
    assert.equal(h.pages.get('2').inCount, first);
    assert.equal(h.edges.size, [...h.edges.values()].length);
  });
});

describe('keeping up between sweeps', () => {
  test('editing a page replaces its links rather than adding to them', async () => {
    const h = harness();
    await h.runSweep();
    const before = (await h.deps.loadEdges('1')).length;

    const edited = { ...SITE[0], version: 4, storage: '<p>all the links are gone</p>' };
    await reindexOne(h.asApi(edited), h.deps);

    assert.ok(before > 0);
    assert.deepEqual(await h.deps.loadEdges('1'), []);
  });

  test('a new link on an edited page is resolved immediately', async () => {
    const h = harness();
    await h.runSweep();
    const edited = {
      ...SITE[3], version: 2,
      storage: '<ac:link><ri:page ri:content-title="Deploy Runbook"/></ac:link>',
    };
    const result = await reindexOne(h.asApi(edited), h.deps);
    assert.equal(result.edges, 1);
    const [edge] = await h.deps.loadEdges('4');
    assert.equal(edge.state, 'ok');
  });

  test('a deleted page stops claiming to link anywhere', async () => {
    const h = harness();
    await h.runSweep();
    await forgetPage('1', h.deps);
    assert.equal(h.pages.has('1'), false);
    assert.deepEqual(await h.deps.loadEdges('1'), []);
  });
});

describe('when things go wrong', () => {
  test('a failure stops the sweep and is recorded, not swallowed', async () => {
    const h = harness();
    h.deps.fetchPages = async () => { throw new Error('Confluence said 503'); };
    const state = await sweepStep(newSweep(0), h.deps);
    assert.equal(state.phase, 'failed');
    assert.match(state.error, /503/);
    assert.equal(isRunning(state), false);
  });

  test('a page with an unreadable body is indexed as having no links', () => {
    const read = readPage({ id: '9', spaceKey: 'X', title: 'Empty', version: 1 });
    assert.deepEqual(read.edges, []);
    assert.equal(read.row.outCount, 0);
  });
});

describe('not asking storage the same question twice', () => {
  test('a target linked from many pages is looked up once per step', async () => {
    const calls = [];
    const lookup = memoLookup({
      loadPage: async (id) => { calls.push(id); return { id }; },
      findByTitle: async () => [],
    });
    await lookup.byId('2');
    await lookup.byId('2');
    await lookup.byId('2');
    assert.deepEqual(calls, ['2']);
  });

  test('space keys fold the same way in storage and in a filter', () => {
    assert.equal(fold('OPS'), 'ops');
  });
});

describe('the hourly catch-up', () => {
  test('a page edited since the sweep is re-read', async () => {
    const h = harness(SITE, { pageSize: 50 });
    await h.runSweep();

    const edited = {
      ...SITE[3], version: 2,
      storage: '<ac:link><ri:page ri:content-title="Deploy Runbook"/></ac:link>',
    };
    h.setRecent([edited, ...SITE.filter((p) => p.id !== edited.id)]);

    const result = await catchUp(h.deps, { settled: 2 });
    assert.equal(result.reindexed, 1);
    const [edge] = await h.deps.loadEdges('4');
    assert.equal(edge.state, 'ok');
  });

  test('an hour in which nothing changed costs one request', async () => {
    const h = harness(SITE, { pageSize: 50 });
    await h.runSweep();
    const before = h.calls.recent;

    const result = await catchUp(h.deps, { settled: 3 });
    assert.equal(result.reindexed, 0);
    assert.equal(result.stoppedEarly, true, 'it must stop once it reaches known versions');
    assert.equal(h.calls.recent - before, 1, `made ${h.calls.recent - before} requests`);
  });

  test('it stops at the first run of unchanged pages rather than reading on', async () => {
    const h = harness(SITE, { pageSize: 50 });
    await h.runSweep();
    h.setRecent([...SITE].reverse());

    const result = await catchUp(h.deps, { settled: 2 });
    assert.equal(result.stoppedEarly, true);
    assert.ok(result.seen <= 3, `looked at ${result.seen} pages to find nothing`);
  });

  test('a page the index has never seen is indexed', async () => {
    const h = harness(SITE, { pageSize: 50 });
    await h.runSweep();

    const fresh = {
      id: '9', spaceKey: 'OPS', title: 'Brand New', version: 1,
      storage: '<ac:link><ri:page ri:content-title="Deploy Runbook"/></ac:link>',
    };
    h.setRecent([fresh, ...SITE]);

    const result = await catchUp(h.deps, { settled: 2 });
    assert.equal(result.reindexed, 1);
    assert.equal(h.pages.get('9').title, 'Brand New');
  });

  test('a busy hour is bounded, and says it did not finish', async () => {
    const h = harness(SITE, { pageSize: 2 });
    await h.runSweep();
    // Every page looks edited, so nothing settles and the ceiling is what stops it.
    h.setRecent(SITE.map((p) => ({ ...p, version: p.version + 1 })));

    const result = await catchUp(h.deps, { max: 3, settled: 10 });
    assert.equal(result.stoppedEarly, false);
    assert.ok(result.seen <= 3, `read ${result.seen} pages despite a ceiling of 3`);
  });
});
