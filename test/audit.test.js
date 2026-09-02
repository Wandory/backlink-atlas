import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { audit } from '../scripts/audit.js';
import * as realAuthz from '../src/authz.js';
import * as realGraph from '../src/graph.js';
import * as realResolve from '../src/resolve.js';

/*
 * Testing the auditor.
 *
 * An audit that has never found anything is indistinguishable from an audit
 * that cannot. So every check is pointed at code written to be exactly the
 * thing it looks for, and has to catch it. When a check quietly stops working,
 * this file goes red instead of the report going green.
 */

const GOOD_MANIFEST = `
app:
  id: ari:cloud:ecosystem::app/real-one
  storage:
    entities:
      - name: edge
        indexes:
          - name: by-target
permissions:
  scopes:
    - read:page:confluence
    - storage:app
`;

const GOOD_PKG = JSON.stringify({ dependencies: { '@forge/api': '8.0.5' } });

/** A minimal set of files that produces no findings, to vary one at a time. */
const clean = (over = {}) => new Map(Object.entries({
  'manifest.yml': GOOD_MANIFEST,
  'package.json': GOOD_PKG,
  'src/index.js':
    'async function backlinksFor() { return filterBySource(rows); }\n'
    + 'async function spaceReport() { return filterBySource(rows); }\n'
    + "resolver.define('runSweep', requireAdmin(isSiteAdmin, run));\n"
    + "resolver.define('stopSweep', requireAdmin(isSiteAdmin, stop));\n"
    + 'export const byline = backlinksFor;\n',
  'src/authz.js': 'try { x(); } catch { return false; }\n',
  'src/store.js': 'const max = 10; chunk(rows); kvs.batchSet(x);\n',
  ...over,
}));

const ids = (result) => result.findings.map((f) => f.id);

/** The real modules, so only the static half varies. */
const REAL = { authz: realAuthz, graph: realGraph, resolve: realResolve };

async function run(files, modules = {}) {
  return audit({ files, ...REAL, ...modules });
}

describe('the leak this app could cause', () => {
  test('backlinks returned without a permission filter is a high finding', async () => {
    const result = await run(clean({
      'src/index.js': 'async function backlinksFor() { return rows; }\n'
        + 'async function spaceReport() { return filterBySource(rows); }\n'
        + 'export const byline = backlinksFor;\n',
    }));
    const f = result.findings.find((x) => x.id === 'authz.leak-backlinks');
    assert.ok(f, `not caught: ${ids(result)}`);
    assert.equal(f.severity, 'high');
    assert.match(f.why, /cannot open/);
  });

  test('the space report is checked too, not just the macro', async () => {
    const result = await run(clean({
      'src/index.js': 'async function backlinksFor() { return filterBySource(rows); }\n'
        + 'async function spaceReport() { return rows; }\n'
        + 'export const byline = backlinksFor;\n',
    }));
    assert.ok(ids(result).includes('authz.leak-backlinks'), ids(result).join());
  });

  test('an unfiltered byline count is caught', async () => {
    const result = await run(clean({
      'src/index.js': 'async function backlinksFor() { return filterBySource(rows); }\n'
        + 'async function spaceReport() { return filterBySource(rows); }\n'
        + 'export const byline = () => store.countEdges();\n',
    }));
    assert.ok(ids(result).includes('authz.leak-byline'), ids(result).join());
  });
});

describe('authorising the caller', () => {
  test('an ungated resolver that costs the site something is caught', async () => {
    const result = await run(clean({
      'src/index.js': "resolver.define('runSweep', async () => beginSweep());\n"
        + 'async function backlinksFor() { return filterBySource(r); }\n'
        + 'async function spaceReport() { return filterBySource(r); }\n'
        + 'export const byline = backlinksFor;\n',
    }));
    const f = result.findings.find((x) => x.id === 'authz.resolver-unguarded');
    assert.ok(f, ids(result).join());
    assert.equal(f.severity, 'high');
    assert.match(f.fix, /requireAdmin/);
  });

  test('a permission check with no failure path is caught', async () => {
    const result = await run(clean({ 'src/authz.js': 'export const isSiteAdmin = () => true;\n' }));
    assert.ok(ids(result).includes('authz.failure-is-permission'), ids(result).join());
  });
});

describe('permissions and egress', () => {
  test('a write scope is a high finding', async () => {
    const result = await run(clean({
      'manifest.yml': `${GOOD_MANIFEST}\n    - write:page:confluence\n`,
    }));
    const f = result.findings.find((x) => x.id === 'scope.excessive');
    assert.ok(f, ids(result).join());
    assert.equal(f.severity, 'high');
  });

  test('declaring egress is caught, because the listing promises none', async () => {
    const result = await run(clean({
      'manifest.yml': `${GOOD_MANIFEST}\n  external:\n    fetch:\n      backend:\n        - '*.example.com'\n`,
    }));
    assert.ok(ids(result).includes('egress.declared'), ids(result).join());
  });
});

describe('secrets and privacy', () => {
  test('a committed token is caught', async () => {
    const result = await run(clean({
      'src/config.js': "const token = 'ATATT3xFfGF0abcdefghijklmnop';\n",
    }));
    assert.ok(ids(result).includes('secret.committed'), ids(result).join());
  });

  test('storing a page body is caught, because the policy says it is not stored', async () => {
    const result = await run(clean({
      'src/crawl.js': 'await savePage(id, { body: page.body.storage.value });\n',
    }));
    const f = result.findings.find((x) => x.id === 'privacy.stores-content');
    assert.ok(f, ids(result).join());
    assert.equal(f.severity, 'high');
  });

  test('logging a page title is caught', async () => {
    const result = await run(clean({
      'src/crawl.js': 'console.log("indexed", page.title);\n',
    }));
    assert.ok(ids(result).includes('privacy.log-content'), ids(result).join());
  });
});

describe('calling Confluence', () => {
  test('a URL built without the route tag is caught', async () => {
    const result = await run(clean({
      'src/index.js': 'await api.asApp().requestConfluence(`/wiki/api/v2/pages?id=${id}`);\n'
        + 'async function backlinksFor() { return filterBySource(r); }\n'
        + 'async function spaceReport() { return filterBySource(r); }\n'
        + 'export const byline = backlinksFor;\n',
    }));
    const f = result.findings.find((x) => x.id === 'route.not-tagged');
    assert.ok(f, ids(result).join());
    assert.match(f.fix, /route`/);
  });
});

describe('storage limits', () => {
  test('an unchunked batch is caught', async () => {
    const result = await run(clean({
      'src/store.js': 'const max = 1; kvs.batchSet(everything);\n',
    }));
    assert.ok(ids(result).includes('storage.batch-oversize'), ids(result).join());
  });

  test('a drain with no ceiling is caught', async () => {
    const result = await run(clean({
      'src/store.js': 'chunk(x); kvs.batchSet(y); while (cursor) { rows.push(...more); }\n',
    }));
    assert.ok(ids(result).includes('storage.unbounded-drain'), ids(result).join());
  });

  test('a loop with no exit is caught', async () => {
    const result = await run(clean({
      'src/crawl.js': 'while (true) {\n  hammer();\n}\n',
    }));
    assert.ok(ids(result).includes('dos.unbounded-loop'), ids(result).join());
  });

  test('querying an index the manifest never declared is a high finding', async () => {
    const result = await run(clean({
      'src/store.js': "const max = 1; chunk(x); kvs.entity('edge').query().index('by-typo');\n",
    }));
    const f = result.findings.find((x) => x.id === 'storage.index-undeclared');
    assert.ok(f, ids(result).join());
    assert.equal(f.severity, 'high');
    assert.match(f.why, /empty forever/);
  });
});

describe('the supply', () => {
  test('an import missing from package.json is a high finding', async () => {
    const result = await run(clean({ 'src/store.js': "import x from 'left-pad';\nconst max=1;chunk(a);\n" }));
    const f = result.findings.find((x) => x.id === 'supply.undeclared-dependency');
    assert.ok(f, ids(result).join());
    assert.equal(f.severity, 'high');
  });

  test('an unpinned dependency is reported', async () => {
    const result = await run(clean({
      'package.json': JSON.stringify({ dependencies: { '@forge/api': '^8.0.0' } }),
    }));
    assert.ok(ids(result).includes('supply.unpinned'), ids(result).join());
  });

  test('node built-ins are not mistaken for missing dependencies', async () => {
    const result = await run(clean({ 'src/store.js': "import fs from 'node:fs';\nconst max=1;chunk(a);\n" }));
    assert.ok(!ids(result).includes('supply.undeclared-dependency'), ids(result).join());
  });
});

describe('the interface', () => {
  test('a deprecated UI Kit 1 component is caught', async () => {
    const result = await run(clean({
      'src/frontend/index.jsx': "import { Text, Strong } from '@forge/react';\n",
    }));
    assert.ok(ids(result).includes('ui.deprecated-component'), ids(result).join());
  });
});

describe('the behavioural half', () => {
  test('a permission check that says yes when the call fails is caught', async () => {
    const result = await run(clean(), {
      authz: { ...realAuthz, visiblePages: async () => new Map([['1', {}]]) },
    });
    const f = result.findings.find((x) => x.id === 'authz.failure-is-permission');
    assert.ok(f, ids(result).join());
    assert.equal(f.severity, 'high');
  });

  test('a filter that lets an unseen row through is caught', async () => {
    const result = await run(clean(), {
      authz: {
        ...realAuthz,
        visiblePages: async () => new Map(),
        filterBySource: async (rows) => ({ rows, withheld: 0 }),
      },
    });
    assert.ok(ids(result).includes('authz.filter-passes-unseen'), ids(result).join());
  });

  test('a key builder that emits an illegal key is caught', async () => {
    const result = await run(clean(), {
      graph: { ...realGraph, edgeKey: (id, link) => `${id}|${link.title}` },
    });
    assert.ok(ids(result).includes('storage.unusable-key'), ids(result).join());
  });

  test('a row carrying an empty string is caught', async () => {
    const result = await run(clean(), {
      graph: { ...realGraph, edgeRow: () => ({ sourceSpace: '', state: 'new' }) },
    });
    assert.ok(ids(result).includes('storage.empty-string'), ids(result).join());
  });

  test('a row that starts carrying page text is caught', async () => {
    const result = await run(clean(), {
      graph: {
        ...realGraph,
        pageRow: (page) => ({ ...realGraph.pageRow(page), excerpt: page.body }),
      },
    });
    const found = ids(result);
    assert.ok(found.includes('privacy.stores-content') || found.includes('privacy.row-widened'),
      found.join());
  });

  test('a new stored field is caught even when it holds nothing secret', async () => {
    const result = await run(clean(), {
      graph: { ...realGraph, edgeRow: (a) => ({ ...realGraph.edgeRow(a), owner: 'someone' }) },
    });
    const f = result.findings.find((x) => x.id === 'privacy.row-widened');
    assert.ok(f, ids(result).join());
    assert.match(f.summary, /owner/);
  });

  test('a state outside the vocabulary is caught', async () => {
    const result = await run(clean(), {
      resolve: { ...realResolve, resolveEdge: () => ({ state: 'weird' }) },
    });
    const f = result.findings.find((x) => x.id === 'grading.unknown-state');
    assert.ok(f, ids(result).join());
    assert.match(f.why, /partitions on state/);
  });

  test('crying wolf on a page it cannot check is caught', async () => {
    const result = await run(clean(), {
      resolve: {
        ...realResolve,
        resolveEdge: (edge) => (edge.anchor ? { state: 'anchormissing' } : { state: 'ok' }),
      },
    });
    assert.ok(ids(result).includes('grading.false-alarm'), ids(result).join());
  });
});

describe('the audit of the real app', () => {
  test('there are no high findings', async () => {
    const { findings } = await audit();
    const high = findings.filter((f) => f.severity === 'high');
    assert.deepEqual(high, [], `high findings: ${JSON.stringify(high, null, 2)}`);
  });

  test('an accepted risk is reported as accepted, not hidden', async () => {
    const { accepted } = await audit();
    assert.ok(accepted.length > 0);
    for (const f of accepted) assert.ok(f.because, `${f.id} is accepted without a reason`);
  });

  test('the allow marker requires a reason', async () => {
    const result = await run(clean({
      'src/crawl.js': 'const token = "ATATT3xFfGF0abcdefghij"; // audit:allow\n',
    }));
    assert.ok(ids(result).includes('secret.committed'),
      'a bare audit:allow with no reason must not silence a finding');
  });
});
