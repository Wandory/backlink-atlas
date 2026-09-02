import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { extractLinks, classifyHref, dedupe, identity } from '../src/links.js';

const SITE = 'https://acme.atlassian.net';
const on = (storage) => extractLinks(storage, { baseUrl: SITE });

describe('links to other pages', () => {
  test('a page link names its target by title and space', () => {
    const links = on('<p>See <ac:link><ri:page ri:content-title="Runbook" '
      + 'ri:space-key="OPS"/><ac:plain-text-link-body><![CDATA[the runbook]]>'
      + '</ac:plain-text-link-body></ac:link></p>');
    assert.deepEqual(links, [
      { kind: 'page', via: 'macro', title: 'Runbook', spaceKey: 'OPS' },
    ]);
  });

  test('a link with no space key means the page it sits on', () => {
    const [link] = on('<ac:link><ri:page ri:content-title="Sibling"/></ac:link>');
    assert.equal(link.title, 'Sibling');
    assert.equal(link.spaceKey, undefined);
  });

  test('an anchor on a page link is kept, because it can break on its own', () => {
    const [link] = on('<ac:link ac:anchor="Rollback"><ri:page '
      + 'ri:content-title="Runbook" ri:space-key="OPS"/></ac:link>');
    assert.equal(link.anchor, 'Rollback');
    assert.equal(link.title, 'Runbook');
  });

  test('a self-closing link with only an anchor points inside this page', () => {
    assert.deepEqual(on('<ac:link ac:anchor="Summary"/>'),
      [{ kind: 'anchor', anchor: 'Summary' }]);
  });

  test('a link carrying a content id is kept by id', () => {
    const [link] = on('<ac:link><ri:page ri:content-id="98765"/></ac:link>');
    assert.equal(link.contentId, '98765');
  });

  test('blog posts and attachments are told apart from pages', () => {
    const links = on('<ac:link><ri:blog-post ri:content-title="Postmortem" '
      + 'ri:space-key="ENG" ri:posting-day="2026/03/04"/></ac:link>'
      + '<ac:link><ri:attachment ri:filename="budget.xlsx"/></ac:link>');
    assert.equal(links[0].kind, 'blogpost');
    assert.equal(links[0].postingDay, '2026/03/04');
    assert.equal(links[1].kind, 'attachment');
    assert.equal(links[1].filename, 'budget.xlsx');
  });

  test('user mentions are not edges and are dropped', () => {
    assert.deepEqual(on('<ac:link><ri:user ri:account-id="123:abc"/></ac:link>'), []);
  });
});

describe('titles that would break a naive parser', () => {
  test('an escaped ampersand comes back as one character', () => {
    const [link] = on('<ac:link><ri:page ri:content-title="Sales &amp; Marketing"/></ac:link>');
    assert.equal(link.title, 'Sales & Marketing');
  });

  test('a double-escaped entity is not over-decoded into markup', () => {
    const [link] = on('<ac:link><ri:page ri:content-title="Use &amp;lt;br&amp;gt;"/></ac:link>');
    assert.equal(link.title, 'Use &lt;br&gt;');
  });

  test('numeric entities and quotes in a title survive', () => {
    const [link] = on('<ac:link><ri:page ri:content-title="&#82;&#101;lease &quot;Q3&quot;"/></ac:link>');
    assert.equal(link.title, 'Release "Q3"');
  });

  test('single-quoted attributes parse the same as double-quoted', () => {
    const [link] = on("<ac:link><ri:page ri:content-title='Runbook' ri:space-key='OPS'/></ac:link>");
    assert.equal(link.title, 'Runbook');
    assert.equal(link.spaceKey, 'OPS');
  });
});

describe('code samples are text, not links', () => {
  test('an anchor tag inside a code macro is not counted', () => {
    const storage = '<ac:structured-macro ac:name="code"><ac:plain-text-body>'
      + '<![CDATA[<a href="https://example.com/does-not-exist">click</a>]]>'
      + '</ac:plain-text-body></ac:structured-macro>';
    assert.deepEqual(on(storage), []);
  });

  test('a real link after a code block is still found', () => {
    const storage = '<ac:plain-text-body><![CDATA[<a href="/wiki/spaces/X/pages/1">x</a>]]>'
      + '</ac:plain-text-body><a href="https://example.com/real">real</a>';
    const links = on(storage);
    assert.equal(links.length, 1);
    assert.equal(links[0].url, 'https://example.com/real');
  });

  test('a commented-out link is not counted', () => {
    assert.deepEqual(on('<!-- <a href="https://gone.example">old</a> -->'), []);
  });
});

describe('the several shapes a Confluence URL takes', () => {
  const cases = [
    ['/wiki/spaces/OPS/pages/12345/Runbook', { spaceKey: 'OPS', contentId: '12345' }],
    ['/wiki/spaces/OPS/pages/12345', { spaceKey: 'OPS', contentId: '12345' }],
    [`${SITE}/wiki/spaces/OPS/pages/12345/Runbook`, { spaceKey: 'OPS', contentId: '12345' }],
    ['/wiki/pages/viewpage.action?pageId=6789', { contentId: '6789' }],
    ['/wiki/spaces/ENG/blog/2026/03/04/555/Postmortem', { spaceKey: 'ENG', contentId: '555' }],
  ];
  for (const [href, want] of cases) {
    test(`internal: ${href}`, () => {
      const link = classifyHref(href, SITE);
      assert.equal(link.kind, 'page');
      for (const [k, v] of Object.entries(want)) assert.equal(link[k], v);
    });
  }

  test('a legacy display link names the title, with plus signs as spaces', () => {
    const link = classifyHref('/wiki/display/OPS/Deploy+Runbook', SITE);
    assert.equal(link.title, 'Deploy Runbook');
    assert.equal(link.spaceKey, 'OPS');
  });

  test('an anchor in a URL is carried through', () => {
    const link = classifyHref('/wiki/spaces/OPS/pages/12345/Runbook#Rollback', SITE);
    assert.equal(link.anchor, 'Rollback');
  });

  test('another host is external even if it is also Confluence-shaped', () => {
    const link = classifyHref('https://other.atlassian.net/wiki/spaces/OPS/pages/1', SITE);
    assert.equal(link.external, true);
    assert.equal(link.kind, 'url');
  });

  test('same host but not a page is internal and still not an edge', () => {
    const link = classifyHref(`${SITE}/wiki/search?text=x`, SITE);
    assert.equal(link.kind, 'url');
    assert.equal(link.external, false);
  });

  test('mailto is not a link to check', () => {
    assert.equal(classifyHref('mailto:ops@acme.example'), null);
  });

  test('a bare fragment is an anchor in the current page', () => {
    assert.deepEqual(classifyHref('#Known%20Issues'), { kind: 'anchor', anchor: 'Known Issues' });
  });

  test('a malformed percent escape does not throw', () => {
    assert.doesNotThrow(() => classifyHref('/wiki/display/OPS/100%'), SITE);
  });

  test('with no base URL, an absolute link is treated as external', () => {
    assert.equal(classifyHref(`${SITE}/wiki/spaces/A/pages/1`, '').external, true);
  });
});

describe('deduping', () => {
  test('the same target linked repeatedly is one edge with a count', () => {
    const links = on('<ac:link><ri:page ri:content-title="Runbook" ri:space-key="OPS"/></ac:link>'
      + '<ac:link><ri:page ri:content-title="Runbook" ri:space-key="OPS"/></ac:link>'
      + '<ac:link><ri:page ri:content-title="runbook" ri:space-key="ops"/></ac:link>');
    const edges = dedupe(links);
    assert.equal(edges.length, 1);
    assert.equal(edges[0].count, 3);
  });

  test('the same page at a different anchor is a different edge', () => {
    const edges = dedupe(on(
      '<ac:link ac:anchor="A"><ri:page ri:content-title="R"/></ac:link>'
      + '<ac:link ac:anchor="B"><ri:page ri:content-title="R"/></ac:link>'));
    assert.equal(edges.length, 2);
  });

  test('identity ignores case in titles and space keys but not in anchors', () => {
    assert.equal(identity({ kind: 'page', title: 'R', spaceKey: 'OPS' }),
      identity({ kind: 'page', title: 'r', spaceKey: 'ops' }));
    assert.notEqual(identity({ kind: 'page', title: 'R', anchor: 'a' }),
      identity({ kind: 'page', title: 'R', anchor: 'A' }));
  });
});

describe('input that is not a well-formed page', () => {
  test('an empty body has no links', () => {
    assert.deepEqual(on(''), []);
    assert.deepEqual(on(null), []);
  });

  test('an unclosed ac:link does not swallow the rest of the page', () => {
    const links = on('<ac:link><ri:page ri:content-title="First"/>'
      + '<ac:link><ri:page ri:content-title="Second"/></ac:link>');
    assert.deepEqual(links.map((l) => l.title), ['First', 'Second']);
  });

  test('an href with no closing quote is skipped rather than crashing', () => {
    assert.doesNotThrow(() => on('<a href=broken>x</a>'));
  });
});
