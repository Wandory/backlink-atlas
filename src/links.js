/*
 * Pulling the links out of a page.
 *
 * Confluence stores a page as XHTML-ish "storage format". A link to another
 * page is not a URL there — it is a semantic element naming the target by
 * title and space:
 *
 *   <ac:link><ri:page ri:content-title="Runbook" ri:space-key="OPS"/></ac:link>
 *
 * That is the good case, and it is why this app parses storage format rather
 * than rendered HTML: the target is named, not guessed at from a URL.
 *
 * Everything here is a pure function over a string. No network, no storage.
 * The correctness of the whole product rests on this file, so it is written to
 * be read and tested rather than to be clever.
 */

/** Text that looks like markup but is not: code samples, comments. */
function stripNonMarkup(storage) {
  return String(storage)
    // A code macro keeps its body in CDATA. An <a href> inside it is a sample,
    // not a link, and counting it would invent broken links that do not exist.
    .replace(/<!\[CDATA\[[\s\S]*?\]\]>/g, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ');
}

/** Attributes of a single tag, as a plain object. Handles ' and " quoting. */
function attributes(tag) {
  const out = {};
  const re = /([\w:-]+)\s*=\s*("([^"]*)"|'([^']*)')/g;
  let m;
  while ((m = re.exec(tag)) !== null) {
    out[m[1]] = decode(m[3] !== undefined ? m[3] : m[4]);
  }
  return out;
}

/** The five XML entities, plus numeric ones. Titles really do contain "&". */
function decode(value) {
  return String(value)
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    // Ampersand last, so "&amp;lt;" does not collapse into "<".
    .replace(/&amp;/g, '&');
}

/*
 * Where an <a href> points. Confluence has accumulated several URL shapes over
 * the years and all of them still occur in real pages, so all of them are
 * recognised. Anything that matches none of them is an external link.
 */
const INTERNAL = [
  // Current: /wiki/spaces/KEY/pages/123456/Some+Title
  { re: /^\/wiki\/spaces\/([^/]+)\/pages\/(\d+)(?:\/|$)/, space: 1, id: 2 },
  // Blog posts: /wiki/spaces/KEY/blog/2024/01/02/123456/Title
  { re: /^\/wiki\/spaces\/([^/]+)\/blog\/[\d/]+\/(\d+)(?:\/|$)/, space: 1, id: 2 },
  // Legacy view action, which names the id in the query string.
  { re: /^\/wiki\/pages\/viewpage\.action\?.*\bpageId=(\d+)/, id: 1 },
  { re: /^\/pages\/viewpage\.action\?.*\bpageId=(\d+)/, id: 1 },
  // Legacy display link, which names the title rather than the id.
  { re: /^\/wiki\/display\/([^/]+)\/([^?#]+)/, space: 1, title: 2 },
];

function safeHost(baseUrl) {
  try { return new URL(baseUrl).host.toLowerCase(); } catch { return ''; }
}

/**
 * Classify a raw href.
 *
 * `baseUrl` is the site the page lives on; a link written as a full URL to
 * that host is internal however it was typed.
 */
export function classifyHref(href, baseUrl = '') {
  const raw = String(href ?? '').trim();
  if (!raw) return null;

  // A bare fragment is a jump inside the page that carries it.
  if (raw.startsWith('#')) {
    return { kind: 'anchor', anchor: safeDecodeURI(raw.slice(1)) };
  }
  // mailto:, tel: and friends are not web links and are not checked.
  if (/^(mailto|tel|sms|callto|skype):/i.test(raw)) return null;

  let path = raw;
  let anchor = '';

  if (/^https?:\/\//i.test(raw)) {
    let url;
    try { url = new URL(raw); } catch { return { kind: 'url', url: raw, external: true }; }
    anchor = url.hash ? safeDecodeURI(url.hash.slice(1)) : '';
    const host = baseUrl ? safeHost(baseUrl) : '';
    if (!host || url.host.toLowerCase() !== host) {
      return { kind: 'url', url: raw, external: true };
    }
    path = url.pathname + url.search;
  } else if (raw.startsWith('/')) {
    const hash = raw.indexOf('#');
    if (hash >= 0) {
      anchor = safeDecodeURI(raw.slice(hash + 1));
      path = raw.slice(0, hash);
    }
  } else {
    // A relative link with no leading slash. Rare, and not resolvable without
    // knowing where it came from, so it is reported as-is rather than guessed.
    return { kind: 'url', url: raw, external: true };
  }

  for (const shape of INTERNAL) {
    const m = shape.re.exec(path);
    if (!m) continue;
    const link = { kind: 'page', via: 'url' };
    if (shape.id) link.contentId = m[shape.id];
    if (shape.space) link.spaceKey = safeDecodeURI(m[shape.space]);
    if (shape.title) link.title = safeDecodeURI(m[shape.title].replace(/\+/g, ' '));
    if (anchor) link.anchor = anchor;
    return link;
  }

  // Same host, but not a page: an attachment download, a search, a dashboard.
  return { kind: 'url', url: raw, external: false };
}

/** decodeURIComponent throws on a stray %; a bad escape is not worth a crash. */
function safeDecodeURI(value) {
  try { return decodeURIComponent(value); } catch { return value; }
}

/** The ri:* element inside an <ac:link>, which names the target. */
function resourceIdentifier(inner) {
  const m = /<ri:([\w-]+)\b([^>]*)>/.exec(inner);
  if (!m) return null;
  return { name: m[1], attrs: attributes(m[2]) };
}

function fromResource(ri, anchor) {
  const a = ri.attrs;
  const title = a['ri:content-title'];
  const space = a['ri:space-key'];
  const id = a['ri:content-id'];

  switch (ri.name) {
    case 'page':
    case 'content-entity': {
      const link = { kind: 'page', via: 'macro' };
      if (title) link.title = title;
      if (space) link.spaceKey = space;
      if (id) link.contentId = id;
      if (anchor) link.anchor = anchor;
      return link;
    }
    case 'blog-post': {
      const link = { kind: 'blogpost', via: 'macro' };
      if (title) link.title = title;
      if (space) link.spaceKey = space;
      if (a['ri:posting-day']) link.postingDay = a['ri:posting-day'];
      if (anchor) link.anchor = anchor;
      return link;
    }
    case 'attachment': {
      const link = { kind: 'attachment', filename: a['ri:filename'] ?? '' };
      if (space) link.spaceKey = space;
      if (title) link.title = title;
      return link;
    }
    default:
      // ri:user, ri:space, ri:shortcut, and whatever Atlassian adds later.
      return null;
  }
}

/**
 * Every link on a page, in the order it appears.
 *
 * Results are shaped by `kind`:
 *   page       — title+spaceKey, or contentId, optionally an anchor
 *   blogpost   — title+spaceKey+postingDay
 *   attachment — filename, optionally on a named page
 *   anchor     — a heading in this same page
 *   url        — anything else, `external` saying whether it leaves the site
 *
 * User mentions and space links are deliberately not returned: they are not
 * page-to-page edges and would only inflate the graph.
 */
export function extractLinks(storage, { baseUrl = '' } = {}) {
  const body = stripNonMarkup(storage);
  const found = [];
  let m;

  // Paired <ac:link>…</ac:link>. A missing close tag is common in hand-edited
  // storage, so the match also ends at the next <ac:link rather than running on.
  const paired = /<ac:link\b([^>]*)>([\s\S]*?)(?:<\/ac:link>|(?=<ac:link\b))/g;
  while ((m = paired.exec(body)) !== null) {
    if (m[1].trimEnd().endsWith('/')) continue; // self-closing, handled below
    const attrs = attributes(m[1]);
    const anchor = attrs['ac:anchor'] ?? '';
    const ri = resourceIdentifier(m[2] ?? '');
    if (!ri) {
      if (anchor) found.push({ kind: 'anchor', anchor });
      continue;
    }
    found.push(fromResource(ri, anchor));
  }

  // Self-closing <ac:link ac:anchor="Heading"/> — a jump within this page.
  const selfClosing = /<ac:link\b([^>]*?)\/>/g;
  while ((m = selfClosing.exec(body)) !== null) {
    const anchor = attributes(m[1])['ac:anchor'] ?? '';
    if (anchor) found.push({ kind: 'anchor', anchor });
  }

  // Plain anchors, including the ones Confluence writes for smart links.
  const hrefRe = /<a\b[^>]*?\bhref\s*=\s*("([^"]*)"|'([^']*)')[^>]*>/gi;
  while ((m = hrefRe.exec(body)) !== null) {
    found.push(classifyHref(decode(m[2] !== undefined ? m[2] : m[3]), baseUrl));
  }

  // <ri:url ri:value="…"/> appears inside several built-in macros.
  const riUrl = /<ri:url\b([^>]*?)\/?>/g;
  while ((m = riUrl.exec(body)) !== null) {
    const value = attributes(m[1])['ri:value'];
    if (value) found.push(classifyHref(value, baseUrl));
  }

  return found.filter(Boolean);
}

/**
 * The headings on a page, which are what an anchor link lands on.
 *
 * A link written as `Runbook#Rollback` keeps working only while a heading
 * called "Rollback" is still there. Rename the heading and the link silently
 * drops the reader at the top of the page instead — no error, no redirect,
 * nothing to notice. Knowing a page's headings is what lets the app say so.
 *
 * Confluence also allows an explicit anchor macro, which is included here.
 */
export function extractHeadings(storage) {
  const body = stripNonMarkup(storage);
  const out = [];
  let m;

  const headingRe = /<h([1-6])\b[^>]*>([\s\S]*?)<\/h\1>/gi;
  while ((m = headingRe.exec(body)) !== null) {
    const text = decode(m[2].replace(/<[^>]+>/g, '')).trim().replace(/\s+/g, ' ');
    if (text) out.push(text);
  }

  // <ac:structured-macro ac:name="anchor"><ac:parameter ac:name="">Name</…>
  const anchorMacro = /<ac:structured-macro\b[^>]*ac:name="anchor"[^>]*>([\s\S]*?)<\/ac:structured-macro>/gi;
  while ((m = anchorMacro.exec(body)) !== null) {
    const param = /<ac:parameter\b[^>]*>([\s\S]*?)<\/ac:parameter>/i.exec(m[1]);
    if (param) {
      const name = decode(param[1].replace(/<[^>]+>/g, '')).trim();
      if (name) out.push(name);
    }
  }

  return [...new Set(out)];
}

/*
 * Confluence page titles are case sensitive to look at but not to link to, and
 * space keys are upper case by convention and lower case in half the URLs in
 * the wild. Folding them is what makes a link a human wrote match the page it
 * meant.
 */
function low(value) {
  return String(value ?? '').toLowerCase();
}

/** A stable identity for a link, used for deduping and as part of a row key. */
export function identity(link) {
  switch (link.kind) {
    case 'page':
    case 'blogpost':
      return [link.kind, link.contentId ?? '', low(link.spaceKey), low(link.title),
        link.anchor ?? ''].join(' ');
    case 'attachment':
      return ['attachment', low(link.spaceKey), low(link.title), low(link.filename)].join(' ');
    case 'anchor':
      return ['anchor', link.anchor ?? ''].join(' ');
    default:
      return ['url', link.url ?? ''].join(' ');
  }
}

/**
 * Collapse repeats. A page that links to the same target eleven times is one
 * edge with a count of eleven, not eleven edges — the graph records which
 * pages depend on which, and eleven rows would only cost storage.
 */
export function dedupe(links) {
  const byKey = new Map();
  for (const link of links) {
    const key = identity(link);
    const seen = byKey.get(key);
    if (seen) { seen.count += 1; continue; }
    byKey.set(key, { ...link, count: 1 });
  }
  return [...byKey.values()];
}
