import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { resolveEdge, anchorMatches, indexOf, parseRef } from '../src/resolve.js';
import { edgeRow } from '../src/graph.js';

/** A small site to resolve against. */
const PAGES = [
  { id: '100', spaceKey: 'OPS', title: 'Deploy Runbook', anchors: ['rollback steps', 'on call'] },
  { id: '101', spaceKey: 'OPS', title: 'Incident Log', anchors: [] },
  { id: '200', spaceKey: 'ENG', title: 'Deploy Runbook', anchors: [] },
  { id: '201', spaceKey: 'ENG', title: 'Duplicate', anchors: [] },
  { id: '202', spaceKey: 'ENG', title: 'Duplicate', anchors: [] },
];
const INDEX = indexOf(PAGES);

const edge = (link, source = { id: '1', spaceKey: 'OPS', title: 'Home' }) =>
  edgeRow({ source, link });

describe('links that land', () => {
  test('a title in the same space resolves to the page', () => {
    const r = resolveEdge(edge({ kind: 'page', title: 'Deploy Runbook' }), INDEX);
    assert.equal(r.state, 'ok');
    assert.equal(r.targetId, '100');
  });

  test('a title resolves regardless of case and stray spaces', () => {
    const r = resolveEdge(edge({ kind: 'page', title: '  deploy   runbook ' }), INDEX);
    assert.equal(r.state, 'ok');
  });

  test('an id resolves even when the page has since been renamed', () => {
    const r = resolveEdge(edge({ kind: 'page', contentId: '100', title: 'Old Name' }), INDEX);
    assert.equal(r.state, 'ok');
    assert.equal(r.targetId, '100');
  });

  test('the same title in another space is a different page', () => {
    const r = resolveEdge(edge({ kind: 'page', title: 'Deploy Runbook', spaceKey: 'ENG' }), INDEX);
    assert.equal(r.state, 'ok');
    assert.equal(r.targetId, '200');
  });
});

describe('links that do not land', () => {
  test('a title nothing carries is missing, and the reason says why', () => {
    const r = resolveEdge(edge({ kind: 'page', title: 'Gone Page' }), INDEX);
    assert.equal(r.state, 'missing');
    assert.match(r.reason, /Gone Page/);
    assert.match(r.reason, /renamed, moved or deleted/);
  });

  test('an id that is not in the index is missing', () => {
    const r = resolveEdge(edge({ kind: 'page', contentId: '999' }), INDEX);
    assert.equal(r.state, 'missing');
    assert.match(r.reason, /999/);
  });

  test('a title two pages share is ambiguous, not broken', () => {
    const r = resolveEdge(edge({ kind: 'page', title: 'Duplicate', spaceKey: 'ENG' }), INDEX);
    assert.equal(r.state, 'ambiguous');
    assert.match(r.reason, /2 pages/);
  });
});

describe('anchors, where links break silently', () => {
  test('a heading that exists is fine', () => {
    const r = resolveEdge(
      edge({ kind: 'page', title: 'Deploy Runbook', anchor: 'Rollback steps' }), INDEX);
    assert.equal(r.state, 'ok');
  });

  test('a heading that is gone is reported, and the page still opens', () => {
    const r = resolveEdge(
      edge({ kind: 'page', title: 'Deploy Runbook', anchor: 'Rollback procedure' }), INDEX);
    assert.equal(r.state, 'anchormissing');
    assert.match(r.reason, /drops the reader at the top/);
  });

  test('the address-bar form of an anchor matches the heading', () => {
    // Confluence writes "#DeployRunbook-Rollbacksteps" in the URL bar.
    const r = resolveEdge(
      edge({ kind: 'page', title: 'Deploy Runbook', anchor: 'DeployRunbook-Rollbacksteps' }),
      INDEX);
    assert.equal(r.state, 'ok');
  });

  test('a repeated heading with its trailing number still matches', () => {
    assert.ok(anchorMatches('Rollbacksteps-1', PAGES[0]));
  });

  test('a page whose headings were too many to remember is not accused', () => {
    const truncated = { id: '300', spaceKey: 'OPS', title: 'Generated', anchors: [], anchorsTruncated: true };
    const r = resolveEdge(
      edge({ kind: 'page', contentId: '300', anchor: 'Anything' }),
      indexOf([...PAGES, truncated]));
    assert.equal(r.state, 'ok');
    assert.match(r.reason, /too many headings/);
  });

  test('an anchor into this same page is checked against this same page', () => {
    const source = { id: '100', spaceKey: 'OPS', title: 'Deploy Runbook', anchors: ['rollback steps'] };
    const ok = resolveEdge(edge({ kind: 'anchor', anchor: 'Rollback steps' }, source),
      INDEX, { sourcePage: source });
    assert.equal(ok.state, 'ok');

    const bad = resolveEdge(edge({ kind: 'anchor', anchor: 'Nowhere' }, source),
      INDEX, { sourcePage: source });
    assert.equal(bad.state, 'anchormissing');
  });
});

describe('what the app declines to judge', () => {
  test('an off-site link is not checked, and says so', () => {
    const r = resolveEdge(edge({ kind: 'url', url: 'https://example.com/x', external: true }), INDEX);
    assert.equal(r.state, 'external');
    assert.match(r.reason, /Leaves this site/);
  });

  test('an attachment is unchecked, and the reason names the missing permission', () => {
    const r = resolveEdge(edge({ kind: 'attachment', filename: 'a.pdf', title: 'Deploy Runbook' }), INDEX);
    assert.equal(r.state, 'unchecked');
    assert.match(r.reason, /permission/);
  });

  test('a reference this app does not understand is never called broken', () => {
    const r = resolveEdge({ targetRef: 'newthing:whatever' }, INDEX);
    assert.equal(r.state, 'external');
  });

  test('a link naming nothing at all is not an alarm', () => {
    const r = resolveEdge({ targetRef: 'ttl:ops:' }, INDEX);
    assert.equal(r.state, 'external');
  });
});

describe('reference parsing', () => {
  test('a reference splits at its first colon only', () => {
    assert.deepEqual(parseRef('url:https://e.example/a:b'),
      { scheme: 'url', rest: 'https://e.example/a:b' });
  });
  test('a reference with no colon does not throw', () => {
    assert.deepEqual(parseRef('junk'), { scheme: '', rest: 'junk' });
  });
});

describe('the index itself', () => {
  test('it finds every page carrying a shared title', () => {
    assert.equal(INDEX.byTitle('eng', 'duplicate').length, 2);
  });
  test('an unknown title gives an empty list, not undefined', () => {
    assert.deepEqual(INDEX.byTitle('eng', 'nothing'), []);
  });
  test('an unknown id gives null', () => {
    assert.equal(INDEX.byId('nope'), null);
  });
});
