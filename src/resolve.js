/*
 * Deciding what an edge actually is.
 *
 * One rule governs this file: a false alarm is worse than a miss. A report
 * that lists thirty working links as broken gets closed and never opened
 * again, and then the twelve genuinely broken ones are never fixed either. So
 * every ambiguous case here resolves in favour of "this is fine", and where the
 * app cannot check something it says so instead of guessing.
 *
 * Pure functions over a lookup the caller supplies, so every rule can be tested
 * against a known index without any storage.
 */

import { fold } from './graph.js';

/**
 * Anchors as Confluence writes them come in two shapes, and both must match the
 * same heading:
 *
 *   ac:anchor="Rollback steps"            the heading text, as typed
 *   #Runbook-Rollbacksteps                page title, then heading, squashed
 *
 * Comparing squashed forms catches both, plus the hand-written variants people
 * paste out of the address bar.
 */
function squash(value) {
  return String(value ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '');
}

export function anchorMatches(anchor, page) {
  const want = String(anchor ?? '');
  if (!want) return true;

  const headings = page?.anchors ?? [];
  if (fold(want) && headings.includes(fold(want))) return true;

  const w = squash(want);
  if (!w) return true;
  const titlePart = squash(page?.title);

  return headings.some((heading) => {
    const h = squash(heading);
    if (!h) return false;
    return h === w
      // "#PageTitle-Heading", which is what the address bar gives you.
      || `${titlePart}${h}` === w
      // Confluence appends a number when a heading repeats: "…heading-1".
      || (w.startsWith(h) && /^\d*$/.test(w.slice(h.length)))
      || (w.startsWith(`${titlePart}${h}`) && /^\d*$/.test(w.slice(titlePart.length + h.length)));
  });
}

/** Split a stored targetRef back into its parts. */
export function parseRef(ref) {
  const raw = String(ref ?? '');
  const colon = raw.indexOf(':');
  if (colon < 0) return { scheme: '', rest: raw };
  return { scheme: raw.slice(0, colon), rest: raw.slice(colon + 1) };
}

/**
 * What state an edge is in, given a way to look pages up.
 *
 * `lookup.byId(id)` returns a page record or null.
 * `lookup.byTitle(spaceFold, titleFold)` returns every page carrying that title
 * in that space — more than one is possible across archived content, and that
 * is a real answer rather than an error.
 *
 * A page record is `{ id, title, spaceKey, anchors, anchorsTruncated }`.
 *
 * Returns `{ state, targetId?, reason }`. `reason` is written for a person to
 * read in the report, so it says what is wrong in plain words.
 */
export function resolveEdge(edge, lookup, { sourcePage = null } = {}) {
  const { scheme, rest } = parseRef(edge.targetRef);

  if (scheme === 'url') {
    return { state: 'external', reason: 'Leaves this site. Not checked.' };
  }
  if (scheme === 'att') {
    return {
      state: 'unchecked',
      reason: 'An attachment. This app does not ask for permission to read attachments, so it cannot say whether this one is still there.',
    };
  }

  if (scheme === 'self') {
    return anchorVerdict(edge, sourcePage, sourcePage?.id, 'this page');
  }

  if (scheme === 'id') {
    const page = lookup.byId(rest);
    if (!page) {
      return {
        state: 'missing',
        reason: `Points at page ${rest}, which is not in the index. It was deleted, or it is somewhere this app cannot read.`,
      };
    }
    return anchorVerdict(edge, page, page.id, quoted(page.title));
  }

  if (scheme === 'ttl') {
    const cut = rest.indexOf(':');
    const spaceFold = cut < 0 ? '' : rest.slice(0, cut);
    const titleFold = cut < 0 ? rest : rest.slice(cut + 1);

    if (!titleFold) {
      // A link with no title and no id names nothing. Not the reader's fault
      // and not worth an alarm.
      return { state: 'external', reason: 'Names no target. Not checked.' };
    }

    const matches = lookup.byTitle(spaceFold, titleFold) ?? [];
    if (matches.length === 0) {
      return {
        state: 'missing',
        reason: `No page called ${quoted(edge.targetTitle || titleFold)} in ${spaceFold.toUpperCase() || 'this space'}. It was renamed, moved or deleted.`,
      };
    }
    if (matches.length > 1) {
      return {
        state: 'ambiguous',
        reason: `${matches.length} pages in ${spaceFold.toUpperCase()} are called ${quoted(edge.targetTitle || titleFold)}, so which one this link opens depends on Confluence.`,
      };
    }
    return anchorVerdict(edge, matches[0], matches[0].id, quoted(matches[0].title));
  }

  // An unrecognised scheme is this app's bug, not the customer's broken link.
  return { state: 'external', reason: 'Not a kind of link this app checks.' };
}

function anchorVerdict(edge, page, targetId, what) {
  if (!edge.anchor) return { state: 'ok', targetId, reason: `Lands on ${what}.` };
  if (!page) {
    return { state: 'ok', targetId, reason: 'Not checked: the page it points at is not in the index.' };
  }
  if (page.anchorsTruncated) {
    return {
      state: 'ok',
      targetId,
      reason: `${what} has too many headings for this app to remember, so the anchor was not checked.`,
    };
  }
  if (anchorMatches(edge.anchor, page)) {
    return { state: 'ok', targetId, reason: `Lands on "${edge.anchor}" in ${what}.` };
  }
  return {
    state: 'anchormissing',
    targetId,
    reason: `${what} exists, but has no heading called "${edge.anchor}" any more. The link still opens the page and drops the reader at the top of it.`,
  };
}

function quoted(value) {
  const v = String(value ?? '').trim();
  return v ? `"${v}"` : 'that page';
}

/**
 * A page index built from rows, with the two lookups `resolveEdge` needs.
 * Kept here so the crawler and the tests build it the same way.
 */
export function indexOf(pages) {
  const byId = new Map();
  const byTitle = new Map();
  for (const page of pages) {
    byId.set(String(page.id), page);
    const key = `${fold(page.spaceKey)}:${fold(page.title)}`;
    const list = byTitle.get(key);
    if (list) list.push(page); else byTitle.set(key, [page]);
  }
  return {
    byId: (id) => byId.get(String(id)) ?? null,
    byTitle: (spaceFold, titleFold) => byTitle.get(`${spaceFold}:${titleFold}`) ?? [],
    size: byId.size,
  };
}
