#!/usr/bin/env node
/**
 * The security audit.
 *
 * The checks are taken from two published documents rather than invented:
 *
 *   - Atlassian Marketplace, "Security requirements for cloud apps". Mandatory
 *     for every listed app, free ones included. Requirement 1: "An application
 *     must authenticate and authorize every request on all endpoints exposed."
 *   - Forge platform security: an `asApp()` request carries the app's
 *     permissions, not the caller's. The app must check the caller itself.
 *
 * This app has one risk that dominates all the others, and it is not a
 * traditional vulnerability. The index is built with the app's permissions, so
 * it knows every page on the site, including the ones the person reading a
 * report may not open. Handing them a backlink that names a page they cannot
 * see leaks its existence and its title. Several checks below exist only to
 * make sure that cannot happen quietly.
 *
 * Half the checks are static, which is all one can do about something missing.
 * The other half are behavioural: they call the real exported functions with
 * hostile input and read what comes back.
 *
 * Run with `npm run audit`. The test suite runs it too and fails the build on
 * any high finding, so it cannot rot quietly.
 *
 * A line ending `// audit:allow <reason>` is passed over. The reason is
 * required, and it is read by whoever comes next.
 */

import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, relative, extname } from 'node:path';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const rel = (p) => relative(ROOT, p).split('\\').join('/');

export const SEVERITY = { high: 0, medium: 1, low: 2, note: 3 };

/**
 * Risks looked at and accepted, with the reason.
 *
 * A finding that has been answered belongs in the report as answered. Deleting
 * the check instead would let the next reader believe nobody ever asked.
 */
const ACCEPTED = {
  'supply.third-party:react':
    'react is what @forge/react renders with, pinned to the version @forge/react '
    + 'itself depends on so the app cannot end up with two copies of React.',
  'freshness.rename-lag':
    'Renaming a page can break links on other pages that named it by its old '
    + 'title, and those are only found by the next sweep. Every report states '
    + 'when the index was last rebuilt, so a reader can judge the answer rather '
    + 'than being given a comforting silence.',
};

const ALLOWED = /\/\/\s*audit:allow\s+\S/;

/** Every source file worth reading. */
function sources(dir = join(ROOT, 'src'), out = []) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) { sources(path, out); continue; }
    if (['.js', '.jsx'].includes(extname(name))) out.push(path);
  }
  return out;
}

function loadFiles() {
  const files = new Map();
  for (const path of sources()) files.set(rel(path), readFileSync(path, 'utf8'));
  for (const extra of ['manifest.yml', 'package.json']) {
    const path = join(ROOT, extra);
    if (existsSync(path)) files.set(extra, readFileSync(path, 'utf8'));
  }
  return files;
}

/** Lines of a file that match, minus the ones explicitly allowed. */
function hits(text, re) {
  const out = [];
  text.split(/\r?\n/).forEach((line, i) => {
    if (re.test(line) && !ALLOWED.test(line)) out.push({ line: i + 1, text: line.trim() });
  });
  return out;
}

/**
 * Run the audit.
 *
 * Everything it reads can be injected, so each check can be pointed at code
 * known to be bad and shown to actually catch it. A check nobody has ever seen
 * fire is not a check.
 */
export async function audit(over = {}) {
  const files = over.files ?? loadFiles();
  const findings = [];
  const report = (id, severity, where, summary, extra = {}) =>
    findings.push({ id, severity, where, summary, ...extra });

  const src = (name) => files.get(name) ?? '';
  const manifest = src('manifest.yml');
  const pkg = src('package.json');
  const code = [...files]
    .filter(([name]) => name.startsWith('src/'))
    .map(([name, text]) => ({ name, text }));

  /* --------------------- the leak this app could cause ------------------- */

  // Every function that hands index rows back to a caller must put them
  // through the permission filter first.
  const index = src('src/index.js');
  for (const fn of ['backlinksFor', 'spaceReport']) {
    const body = between(index, `function ${fn}`);
    if (!body) {
      report('authz.reader-missing', 'medium', 'src/index.js',
        `${fn} was not found, so the auditor cannot confirm it filters by permission.`);
      continue;
    }
    if (!/filterBySource|visiblePages/.test(body)) {
      report('authz.leak-backlinks', 'high', 'src/index.js',
        `${fn} returns rows read with the app's permissions without asking whether the caller may see them.`, {
          why: 'The index knows every page on the site. Returning a row names a page, and naming a page the reader cannot open is the leak.',
          fix: 'Pass the rows through filterBySource, or the ids through visiblePages, before returning them.',
        });
    }
  }

  // The byline shows a number to everyone who can see the page. It must be the
  // filtered number, or it counts pages the reader cannot see.
  const byline = between(index, 'export const byline');
  if (byline && !/backlinksFor|filterBySource/.test(byline)) {
    report('authz.leak-byline', 'high', 'src/index.js',
      'The byline count is produced without the permission filter.', {
        why: 'A count that includes restricted pages tells the reader they exist.',
      });
  }

  /* ------------------------ authorising the caller ----------------------- */

  const guarded = /requireAdmin\s*\(/;
  for (const name of ['runSweep', 'stopSweep']) {
    const line = index.split(/\r?\n/).find((l) => l.includes(`define('${name}'`));
    if (line && !guarded.test(line)) {
      report('authz.resolver-unguarded', 'high', 'src/index.js',
        `The ${name} resolver runs for any user of the site.`, {
          why: 'Forge resolvers do not authorize. Any logged-in user can invoke any resolver the app exposes.',
          fix: `Wrap it: resolver.define('${name}', requireAdmin(isSiteAdmin, handler))`,
        });
    }
  }

  // A permission check that answers "allowed" when it fails is worse than none.
  const authz = src('src/authz.js');
  if (authz && !/catch\s*(\{|\()/.test(authz)) {
    report('authz.failure-is-permission', 'high', 'src/authz.js',
      'The permission check does not handle a failed call, so an error may read as permission.');
  }

  /* ------------------------------ the scopes ----------------------------- */

  const scopes = [...manifest.matchAll(/^\s*-\s*((?:read|write|delete|manage|admin|storage)[:\w.-]+)\s*$/gm)]
    .map((m) => m[1]);

  for (const scope of scopes) {
    if (/^(write|delete|manage|admin):/.test(scope)) {
      report('scope.excessive', 'high', 'manifest.yml',
        `${scope} lets this app change the site. It only ever reads.`, { evidence: scope });
    }
  }
  if (/permissions:[\s\S]*?\n\s{2}external:/.test(manifest)) {
    report('egress.declared', 'high', 'manifest.yml',
      'External permissions are declared, so the app can send data off the site.', {
        why: 'The listing and the privacy policy both state that nothing leaves Atlassian. Declaring egress makes that untrue.',
      });
  }

  /* ------------------------------- secrets ------------------------------- */

  for (const { name, text } of [...code, { name: 'manifest.yml', text: manifest }]) {
    for (const hit of hits(text, /(ATATT|ATCTT)[A-Za-z0-9_-]{10,}|-----BEGIN [A-Z ]*PRIVATE KEY/)) {
      report('secret.committed', 'high', `${name}:${hit.line}`,
        'A credential appears to be committed.');
    }
  }

  /* ----------------------------- privacy --------------------------------- */

  // The app reads page bodies. It must not keep them. A write whose argument
  // mentions a body at all is treated as one that stores it: the check is
  // deliberately blunt, because the promise it protects is absolute.
  // Only writes that reach Forge storage count. `map.set(...)` is not one, and
  // an auditor that cries wolf about its own code teaches people to ignore it.
  const WRITES = /\bsavePage\s*\(|\bkvs\.[\w.()'"\s]*\.?set\s*\(|\bbatchSet\s*\(|entity\([^)]*\)\.set\s*\(/;
  const CONTENT = /\bbody\b|storage\.value/;
  for (const { name, text } of code) {
    for (const hit of hits(text, WRITES)) {
      if (CONTENT.test(hit.text)) {
        report('privacy.stores-content', 'high', `${name}:${hit.line}`,
          'A page body looks like it is being written to storage.', {
            why: 'The privacy policy says the app stores connections, not words. Storing a body makes that false.',
            evidence: hit.text.slice(0, 120),
          });
      }
    }
    for (const hit of hits(text, /console\.(log|info|warn|error)\s*\([^)]*\b(title|body|storage|summary)\b/)) {
      report('privacy.log-content', 'medium', `${name}:${hit.line}`,
        'Customer content may be written to logs the vendor can read.', {
          evidence: hit.text.slice(0, 120),
        });
    }
  }

  /* ------------------------ calling Confluence --------------------------- */

  for (const { name, text } of code) {
    for (const hit of hits(text, /request(Confluence|Jira)\s*\(\s*[`'"]/)) {
      if (!/route`/.test(hit.text)) {
        report('route.not-tagged', 'high', `${name}:${hit.line}`,
          'A product URL is built without the route tag, so a value in it is not escaped.', {
            fix: 'Use route`/wiki/api/v2/...` — the tag encodes every interpolated value.',
            evidence: hit.text.slice(0, 120),
          });
      }
    }
  }

  /* --------------------------- storage limits ---------------------------- */

  const store = src('src/store.js');
  for (const hit of hits(store, /batchSet|batchDelete|batchGet/)) {
    // Every batch must be chunked; the platform takes 25 keys at most.
    if (!/chunk\(/.test(store)) {
      report('storage.batch-oversize', 'medium', `src/store.js:${hit.line}`,
        'A batch operation is used without chunking to the 25-key limit.');
      break;
    }
  }
  if (store && !/max\s*[=:]/.test(store)) {
    report('storage.unbounded-drain', 'medium', 'src/store.js',
      'A query is drained without a ceiling. An unbounded read is how an app gets suspended.');
  }

  for (const { name, text } of code) {
    for (const hit of hits(text, /\bwhile\s*\(\s*(true|1)\s*\)|\bfor\s*\(\s*;\s*;\s*\)/)) {
      const window = text.split(/\r?\n/).slice(hit.line - 1, hit.line + 25).join('\n');
      if (!/break|return|\+=\s*1|throw/.test(window)) {
        report('dos.unbounded-loop', 'medium', `${name}:${hit.line}`,
          'A loop with no visible exit.');
      }
    }
  }

  /* ------------------------------ the manifest --------------------------- */

  if (/REPLACE-WITH/.test(manifest)) {
    report('manifest.placeholder-id', 'medium', 'manifest.yml',
      'The app id is still the placeholder. Run forge register before deploying.');
  }

  const declaredIndexes = new Set(
    [...manifest.matchAll(/^\s*-\s*name:\s*([a-z0-9:_.-]+)\s*$/gim)].map((m) => m[1]),
  );
  for (const { name, text } of code) {
    for (const m of text.matchAll(/\.index\(\s*'([^']+)'/g)) {
      if (!declaredIndexes.has(m[1])) {
        report('storage.index-undeclared', 'high', name,
          `The code queries index "${m[1]}", which the manifest does not define.`, {
            why: 'The query does not fail loudly; the report is simply empty forever.',
          });
      }
    }
  }

  /* ---------------------------- the interface ---------------------------- */

  const DEPRECATED = ['Strong', 'Em', 'Strike', 'ModalDialog', 'Fragment'];
  for (const { name, text } of code.filter((f) => f.name.endsWith('.jsx'))) {
    const imported = /import\s*(?:ForgeReconciler\s*,\s*)?\{([^}]*)\}\s*from\s*'@forge\/react'/.exec(text);
    const names = imported ? imported[1].split(',').map((s) => s.trim()) : [];
    for (const bad of DEPRECATED) {
      if (names.includes(bad)) {
        report('ui.deprecated-component', 'low', name,
          `${bad} is a UI Kit 1 component and is deprecated.`);
      }
    }
  }

  /* ------------------------------ the supply ----------------------------- */

  let declaredDeps = {};
  try { declaredDeps = JSON.parse(pkg).dependencies ?? {}; } catch { /* reported below */ }

  for (const { name, text } of code) {
    for (const m of text.matchAll(/from\s*'([^'.][^']*)'/g)) {
      const dep = m[1].startsWith('@') ? m[1].split('/').slice(0, 2).join('/') : m[1].split('/')[0];
      if (dep.startsWith('node:')) continue;
      if (!Object.hasOwn(declaredDeps, dep)) {
        report('supply.undeclared-dependency', 'high', name,
          `${dep} is imported but is not in package.json, so a deploy will fail or resolve something unintended.`);
      }
    }
  }
  for (const [dep, range] of Object.entries(declaredDeps)) {
    if (!/^\d+\.\d+\.\d+$/.test(range)) {
      report('supply.unpinned', 'low', 'package.json',
        `${dep} is ranged at "${range}" rather than pinned, so two builds can differ.`);
    }
    if (!dep.startsWith('@forge/')) {
      report(`supply.third-party:${dep}`, 'note', 'package.json',
        `${dep} is a third-party dependency running inside the app.`);
    }
  }

  /* --------------------------- behavioural ------------------------------- */

  await behavioural(report, over);

  /* --------------------------------- out --------------------------------- */

  const open = [];
  const accepted = [];
  for (const f of findings) {
    if (Object.hasOwn(ACCEPTED, f.id)) accepted.push({ ...f, because: ACCEPTED[f.id] });
    else open.push(f);
  }
  open.sort((a, b) => SEVERITY[a.severity] - SEVERITY[b.severity] || a.id.localeCompare(b.id));
  return { findings: open, accepted };
}

/** The text of a function or block, from its declaration to the next one. */
function between(text, start) {
  const at = text.indexOf(start);
  if (at < 0) return '';
  const rest = text.slice(at + start.length);
  const next = rest.search(/\n(?:export )?(?:async )?function |\nexport const |\nresolver\.define/);
  return next < 0 ? rest : rest.slice(0, next);
}

/**
 * Checks that run the real code.
 *
 * A regex can tell you a permission filter is mentioned. Only calling it can
 * tell you it refuses.
 */
async function behavioural(report, over) {
  const authz = over.authz ?? await import('../src/authz.js');
  const graph = over.graph ?? await import('../src/graph.js');
  const resolve = over.resolve ?? await import('../src/resolve.js');

  // A failed permission call must hide rows, not show them.
  const failing = async () => { throw new Error('network'); };
  const onFailure = await authz.visiblePages(['1', '2'], { request: failing });
  if (onFailure.size !== 0) {
    report('authz.failure-is-permission', 'high', 'src/authz.js',
      'When the permission call fails, pages are treated as visible.', {
        why: 'A failure to answer is not permission.',
      });
  }

  // So must a refusal.
  const refusing = async () => ({ ok: false, status: 403, json: async () => ({}) });
  const onRefusal = await authz.visiblePages(['1'], { request: refusing });
  if (onRefusal.size !== 0) {
    report('authz.refusal-ignored', 'high', 'src/authz.js',
      'A refusal from Confluence does not hide the page.');
  }

  // Only what Confluence actually returned may be shown.
  const partial = async () => ({
    ok: true, status: 200,
    json: async () => ({ results: [{ id: '1', title: 'Visible' }] }),
  });
  const filtered = await authz.filterBySource(
    [{ sourceId: '1' }, { sourceId: '2' }], { request: partial },
  );
  if (filtered.rows.length !== 1 || filtered.withheld !== 1) {
    report('authz.filter-passes-unseen', 'high', 'src/authz.js',
      'A row whose source Confluence did not return survives the filter.', {
        evidence: JSON.stringify(filtered).slice(0, 160),
      });
  }

  // An id that is not an id must never reach the URL.
  const sent = [];
  const spy = async (url) => { sent.push(String(url)); return { ok: true, json: async () => ({ results: [] }) }; };
  await authz.visiblePages(['1', '2&limit=9999', '../../admin', "1' OR '1"], { request: spy });
  const joined = sent.join(' ');
  if (/limit=9999|\.\.|OR/.test(joined)) {
    report('injection.page-ids', 'high', 'src/authz.js',
      'A caller-supplied value reaches the request URL unfiltered.', {
        evidence: joined.slice(0, 200),
      });
  }

  // A hostile page title must never produce an unusable storage key.
  const hostile = ['A/B', 'x'.repeat(600), '日本語 😀', 'a\nb', "'; DROP", '..', '   '];
  for (const title of hostile) {
    try {
      const key = graph.edgeKey('123', { kind: 'page', title });
      if (!/^[a-zA-Z0-9:._\s#-]+$/.test(key) || key.length > 500) {
        report('storage.unusable-key', 'high', 'src/graph.js',
          'A page title can produce a key the platform will reject.', { evidence: key.slice(0, 80) });
        break;
      }
    } catch (error) {
      report('storage.key-throws', 'medium', 'src/graph.js',
        `Building a key from a real title threw: ${error.message}`);
      break;
    }
  }

  /*
   * What a stored row may contain, exhaustively.
   *
   * The regex above is a tripwire. This is the proof: the row builders are
   * called with a page whose every field is filled with recognisable content,
   * and the result must contain no field outside this list and no trace of the
   * body. If someone adds an attribute that carries text, this fails.
   *
   * These two lists are the same lists PRIVACY.md sets out in prose, under
   * "What is stored". Adding a field means changing both, in the same commit,
   * or the build goes red — which is the only way a privacy policy stays true
   * to the code a year later.
   */
  const PAGE_FIELDS = new Set(['spaceKey', 'title', 'titleFold', 'version',
    'inCount', 'outCount', 'brokenCount', 'indexedAt', 'anchors', 'anchorsTruncated']);
  const EDGE_FIELDS = new Set(['sourceId', 'sourceSpace', 'sourceTitle', 'targetRef',
    'targetTitle', 'targetSpace', 'anchor', 'kind', 'state', 'hits', 'seenAt']);

  const SECRET = 'THE-BODY-TEXT-OF-THE-PAGE';
  const builtPage = graph.pageRow({
    spaceKey: 'OPS', title: 'T', version: 1, anchors: ['h'],
    body: SECRET, storage: SECRET, text: SECRET,
  });
  const builtEdge = graph.edgeRow({
    source: { id: '1', spaceKey: 'OPS', title: 'T', body: SECRET },
    link: { kind: 'page', title: 'X', body: SECRET, context: SECRET },
  });

  for (const [what, row, allowed] of [['page', builtPage, PAGE_FIELDS], ['edge', builtEdge, EDGE_FIELDS]]) {
    const extra = Object.keys(row).filter((k) => !allowed.has(k));
    if (extra.length) {
      report('privacy.row-widened', 'high', 'src/graph.js',
        `A ${what} row now carries ${extra.join(', ')}, which the privacy policy does not account for.`, {
          why: 'The policy states what is stored, field by field. A new field makes it inaccurate until it is updated.',
        });
    }
    if (JSON.stringify(row).includes(SECRET)) {
      report('privacy.stores-content', 'high', 'src/graph.js',
        `A ${what} row carries page content through to storage.`);
    }
  }

  // Storage rejects empty strings; a row must never carry one.
  const row = graph.edgeRow({
    source: { id: '1', spaceKey: '', title: '' },
    link: { kind: 'page', title: '', spaceKey: '', anchor: '' },
  });
  const empties = Object.entries(row).filter(([, v]) => typeof v === 'string' && v.trim() === '');
  if (empties.length) {
    report('storage.empty-string', 'medium', 'src/graph.js',
      'A row carries an empty string, which storage refuses.', {
        evidence: JSON.stringify(empties),
      });
  }

  // Every state the resolver can produce must be one the manifest can index.
  const states = new Set();
  const nothing = { byId: () => null, byTitle: () => [] };
  for (const ref of ['id:1', 'ttl:ops:x', 'url:https://e.example', 'att:a:b:c', 'self:', 'junk:x']) {
    states.add(resolve.resolveEdge({ targetRef: ref }, nothing).state);
  }
  for (const state of states) {
    if (!Object.hasOwn(graph.STATES, state)) {
      report('grading.unknown-state', 'medium', 'src/resolve.js',
        `The resolver can produce the state "${state}", which is not in the vocabulary.`, {
          why: 'The report index partitions on state. A state nobody declared is a row nobody can find.',
        });
    }
  }

  // A monitor that cries wolf gets closed and never opened again.
  const falseAlarm = resolve.resolveEdge(
    { targetRef: 'id:1', anchor: 'Whatever' },
    { byId: () => ({ id: '1', title: 'T', anchors: [], anchorsTruncated: true }), byTitle: () => [] },
  );
  if (falseAlarm.state !== 'ok') {
    report('grading.false-alarm', 'medium', 'src/resolve.js',
      'A page whose headings were too many to remember is reported as having a broken anchor.', {
        why: 'The app cannot know, and saying so is the only honest answer.',
      });
  }
}

/* -------------------------------- output --------------------------------- */

const LABEL = { high: 'HIGH  ', medium: 'medium', low: 'low   ', note: 'note  ' };

function print({ findings, accepted }) {
  const counts = {};
  for (const f of findings) counts[f.severity] = (counts[f.severity] ?? 0) + 1;

  console.log('\nBacklink Atlas — security audit\n');

  if (findings.length === 0) {
    console.log('  nothing open.');
  } else {
    for (const f of findings) {
      console.log(`  ${LABEL[f.severity]}  ${f.id}`);
      console.log(`          ${f.where}`);
      console.log(`          ${f.summary}`);
      if (f.why) console.log(`          why: ${f.why}`);
      if (f.fix) console.log(`          fix: ${f.fix}`);
      if (f.evidence) console.log(`          seen: ${f.evidence}`);
      console.log();
    }
  }

  if (accepted.length) {
    console.log('  accepted, with reasons:');
    for (const f of accepted) console.log(`    ${f.id} — ${f.because}`);
    console.log();
  }

  const summary = ['high', 'medium', 'low', 'note']
    .map((s) => `${counts[s] ?? 0} ${s}`).join(', ');
  console.log(`  ${summary}\n`);
  return counts.high ?? 0;
}

if (process.argv[1] && process.argv[1].endsWith('audit.js')) {
  const result = await audit();
  const high = print(result);
  process.exit(high > 0 ? 1 : 0);
}
