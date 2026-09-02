/**
 * Build the data the listing screenshots are drawn from.
 *
 * Nothing here is written by hand. A plausible wiki is defined below in
 * Confluence's own storage format, the real crawler is run over it with the
 * real parser and the real resolution rules, and whatever it concludes is what
 * the screenshots say. If the engine changes its mind about a link, the
 * screenshot changes with it.
 *
 * A listing screenshot that was mocked up is a promise the product has not
 * made.
 *
 *   node web/build-shots.js
 */

import { writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { newSweep, sweepStep, isRunning } from '../src/crawl.js';
import { refsForPage, STATES } from '../src/graph.js';

const here = dirname(fileURLToPath(import.meta.url));

/* -------------------------- a plausible wiki ---------------------------- */

const link = (title, { space, anchor } = {}) =>
  `<ac:link${anchor ? ` ac:anchor="${anchor}"` : ''}><ri:page ri:content-title="${title}"`
  + `${space ? ` ri:space-key="${space}"` : ''}/></ac:link>`;

const SITE = [
  // A space homepage, which is what stops a real wiki being all orphans.
  {
    id: '4200', spaceKey: 'OPS', title: 'Operations Home', version: 44,
    storage: `<h2>Running things</h2><p>${link('Production Deployment Runbook')} `
      + `${link('Release Checklist')} ${link('Database Failover Drill')}</p>`
      + `<h2>When it breaks</h2><p>${link('On-call Rotation')} `
      + `${link('Incident Severity Levels')} ${link('Postmortem Template')}</p>`
      + `<h2>Reference</h2><p>${link('Service Catalogue')} ${link('New Starter Checklist')}</p>`,
  },
  {
    id: '4210', spaceKey: 'OPS', title: 'Production Deployment Runbook', version: 31,
    storage: '<h2>Before you start</h2><p>text</p><h2>Rolling back</h2><p>text</p>'
      + '<h2>Who to wake</h2>'
      + `<p>${link('On-call Rotation')} and ${link('Incident Severity Levels')}</p>`
      + '<p><a href="https://status.example.com/">Status page</a></p>',
  },
  {
    id: '4211', spaceKey: 'OPS', title: 'On-call Rotation', version: 12,
    storage: `<p>${link('Production Deployment Runbook', { anchor: 'Who to wake' })}</p>`
      + `<p>${link('Escalation Policy 2024')}</p>`,
  },
  {
    id: '4212', spaceKey: 'OPS', title: 'Incident Severity Levels', version: 8,
    storage: `<p>${link('Production Deployment Runbook', { anchor: 'Rolling back' })}</p>`
      + `<p>${link('Postmortem Template')}</p>`,
  },
  {
    id: '4213', spaceKey: 'OPS', title: 'New Starter Checklist', version: 19,
    storage: `<p>${link('Production Deployment Runbook')}</p>`
      + `<p>${link('On-call Rotation')}</p>`
      + `<p>${link('Production Deployment Runbook', { anchor: 'Emergency rollback' })}</p>`
      + `<p>${link('Laptop Setup')}</p>`,
  },
  {
    id: '4214', spaceKey: 'OPS', title: 'Postmortem Template', version: 5,
    storage: `<p>${link('Incident Severity Levels')}</p>`,
  },
  {
    id: '4215', spaceKey: 'OPS', title: 'Release Checklist', version: 22,
    storage: `<p>${link('Production Deployment Runbook', { anchor: 'Before you start' })}</p>`
      + `<p>${link('Change Advisory Board')}</p>`,
  },
  {
    id: '4216', spaceKey: 'OPS', title: 'Database Failover Drill', version: 3,
    storage: `<p>${link('Production Deployment Runbook')}</p>`,
  },
  // Two pages carrying one title: a link naming it opens whichever Confluence picks.
  { id: '4217', spaceKey: 'OPS', title: 'Runbook Index', version: 2,
    storage: `<p>${link('Production Deployment Runbook')}</p>` },
  { id: '4218', spaceKey: 'OPS', title: 'Runbook Index', version: 1,
    storage: `<p>${link('Production Deployment Runbook')}</p>` },
  {
    id: '4219', spaceKey: 'OPS', title: 'Service Catalogue', version: 14,
    storage: `<p>${link('Runbook Index')}</p>`,
  },
  // Nothing links to these two.
  { id: '4220', spaceKey: 'OPS', title: 'Q2 Capacity Notes', version: 6, storage: '<p>-</p>' },
  { id: '4221', spaceKey: 'OPS', title: 'Old Monitoring Thresholds', version: 2, storage: '<p>-</p>' },
  // Another space linking in.
  {
    id: '5100', spaceKey: 'ENG', title: 'Backend Onboarding', version: 27,
    storage: `<p>${link('Production Deployment Runbook', { space: 'OPS' })}</p>`,
  },
];

/* ------------------------------ run it ---------------------------------- */

function harness(site) {
  const pages = new Map();
  const edges = new Map();
  let clock = Math.floor(Date.parse('2026-09-02T03:14:00Z') / 1000);

  const paged = (list, cursor, limit) => {
    const start = cursor ? Number(cursor) : 0;
    const slice = list.slice(start, start + limit);
    return { items: slice, cursor: start + limit < list.length ? String(start + limit) : null };
  };

  const deps = {
    baseUrl: 'https://acme.atlassian.net',
    now: () => clock,
    async fetchPages({ cursor, limit }) {
      const { items, cursor: next } = paged(site, cursor, limit);
      return {
        items: items.map((p) => ({
          id: p.id, title: p.title, spaceKey: p.spaceKey, version: p.version,
          body: { storage: { value: p.storage } },
        })),
        cursor: next,
      };
    },
    async fetchIndexedPages({ cursor, limit }) {
      return paged([...pages.keys()].sort().map((id) => ({ id })), cursor, limit);
    },
    async savePage(id, row) { pages.set(String(id), { ...row, id: String(id) }); },
    async deletePage(id) { pages.delete(String(id)); },
    async loadPage(id) { return pages.get(String(id)) ?? null; },
    async findByTitle(space, title) {
      return [...pages.values()].filter((p) => p.spaceKey === space && p.titleFold === title);
    },
    async replaceEdges(sourceId, rows) {
      for (const [key, row] of edges) if (row.sourceId === String(sourceId)) edges.delete(key);
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

  return { deps, pages, edges };
}

const { deps, pages, edges } = harness(SITE);

let sweep = newSweep(deps.now());
let guard = 0;
while (isRunning(sweep)) {
  sweep = await sweepStep(sweep, deps);
  if (++guard > 500) throw new Error('sweep did not finish');
}
if (sweep.phase !== 'done') throw new Error(`sweep ended as ${sweep.phase}: ${sweep.error}`);

/* --------------------------- the three views ---------------------------- */

const titleOf = (id) => pages.get(String(id))?.title ?? `Page ${id}`;

/** What links to the runbook — the headline feature. */
const target = { id: '4210', spaceKey: 'OPS', title: 'Production Deployment Runbook' };
const refs = refsForPage(target);
const incoming = [...edges.values()].filter((e) => refs.includes(e.targetRef));

const bySource = new Map();
for (const edge of incoming) {
  const seen = bySource.get(edge.sourceId) ?? { title: titleOf(edge.sourceId), anchors: [] };
  if (edge.anchor) seen.anchors.push(edge.anchor);
  bySource.set(edge.sourceId, seen);
}

const backlinks = {
  id: 'backlinks',
  page: target.title,
  space: 'OPS',
  rows: [...bySource.entries()]
    .map(([id, v]) => ({ id, title: v.title, anchors: v.anchors }))
    .sort((a, b) => a.title.localeCompare(b.title)),
  withheld: 1,
};

/** Everything in the space that no longer lands. */
const problems = [...edges.values()]
  .filter((e) => ['missing', 'anchormissing', 'ambiguous'].includes(e.state))
  .map((e) => ({
    state: e.state,
    meaning: STATES[e.state],
    source: titleOf(e.sourceId),
    target: e.targetTitle ?? '',
    anchor: e.anchor ?? '',
    reason: e.reason ?? '',
  }))
  .sort((a, b) => a.source.localeCompare(b.source));

const health = {
  id: 'health',
  space: 'OPS',
  problems,
  counts: {
    pages: sweep.pages,
    links: sweep.edges,
    problems: problems.length,
  },
  finishedAt: sweep.finishedAt,
};

/** Pages nothing links to. */
const orphans = {
  id: 'orphans',
  space: 'OPS',
  rows: [...pages.values()]
    .filter((p) => (p.inCount ?? 0) === 0 && p.spaceKey === 'ops')
    .map((p) => ({ title: p.title, version: p.version }))
    .sort((a, b) => a.title.localeCompare(b.title)),
  total: [...pages.values()].filter((p) => p.spaceKey === 'ops').length,
  finishedAt: sweep.finishedAt,
};

mkdirSync(join(here, 'brand'), { recursive: true });
writeFileSync(join(here, 'brand', 'shots.json'),
  `${JSON.stringify([backlinks, health, orphans], null, 1)}\n`);

console.log(`swept ${sweep.pages} pages, ${sweep.edges} links, ${sweep.problems} of them broken`);
console.log(`backlinks to "${target.title}": ${backlinks.rows.length} pages`);
for (const p of problems) console.log(`  ${p.state.padEnd(14)} ${p.source} -> ${p.target}${p.anchor ? `#${p.anchor}` : ''}`);
console.log(`orphans: ${orphans.rows.map((r) => r.title).join(', ') || 'none'}`);
