/*
 * The shape of the graph in storage.
 *
 * Three rules from the platform drive almost every decision here, and breaking
 * any of them is a runtime error rather than a warning:
 *
 *   1. An entity key may only contain  a-z A-Z 0-9 : . _ - # and spaces.
 *      Page titles may contain anything at all, so a title can never be part of
 *      a key. Keys are built from ids and a hash instead.
 *   2. A stored string must not be empty. An absent value is omitted, never
 *      written as "".
 *   3. An integer attribute is 32-bit signed.
 *
 * Everything in this file is pure. It is the contract the storage layer and the
 * tests share.
 */

import { identity } from './links.js';

/** The key characters the platform allows, as a guard for our own keys. */
const SAFE_KEY = /^[a-zA-Z0-9:._\s#-]+$/;
const MAX_KEY = 500;
const INT_MAX = 2147483647;

/**
 * Titles compare case-insensitively in Confluence links, and real pages differ
 * by stray double spaces more often than anyone would like. Folding both sides
 * the same way is what makes a link a human typed match the page it meant.
 */
export function fold(value) {
  return String(value ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
}

/**
 * FNV-1a, twice, over 32 bits each — 16 hex characters.
 *
 * Written out rather than imported so it cannot change under the app: these
 * hashes are stored in keys, and a different hash function on a later deploy
 * would orphan every row already written.
 */
export function hash(value) {
  const s = String(value);
  let a = 0x811c9dc5;
  let b = 0x01000193;
  for (let i = 0; i < s.length; i += 1) {
    const c = s.charCodeAt(i);
    a = Math.imul(a ^ c, 0x01000193) >>> 0;
    b = Math.imul(b ^ (c + i), 0x85ebca6b) >>> 0;
  }
  return (a.toString(16).padStart(8, '0') + b.toString(16).padStart(8, '0'));
}

/** Clamp to what an integer attribute can hold, and never store a fraction. */
export function int(value, fallback = 0) {
  const n = Math.trunc(Number(value));
  if (!Number.isFinite(n)) return fallback;
  return Math.max(-INT_MAX - 1, Math.min(INT_MAX, n));
}

/**
 * The value a link is looked up by. This is the partition of the reverse
 * index, so it is the single most important string in the app.
 *
 *   id:12345            a link that named the page's id
 *   ttl:ops:runbook     a link that named a space and title
 *   att:ops:runbook:a.pdf
 *   url:https://…       anything off-site
 *   self:12345          an anchor inside the page itself
 *
 * `sourceSpace` fills in the space for links that omitted it, which is most of
 * them: a link to a page in the same space usually carries only a title.
 */
export function targetRef(link, sourceSpace = '') {
  const space = fold(link.spaceKey || sourceSpace);
  switch (link.kind) {
    case 'page':
    case 'blogpost':
      if (link.contentId) return `id:${link.contentId}`;
      return `ttl:${space}:${fold(link.title)}`;
    case 'attachment':
      return `att:${space}:${fold(link.title)}:${fold(link.filename)}`;
    case 'anchor':
      return 'self:';
    default:
      // A URL can be arbitrarily long; the partition has a 1700-byte ceiling,
      // so a very long one is truncated and tagged with its hash to stay
      // distinct from every other URL that shares the same prefix.
      return truncateRef(`url:${link.url ?? ''}`);
  }
}

function truncateRef(ref) {
  if (Buffer.byteLength(ref, 'utf8') <= 1500) return ref;
  return `${ref.slice(0, 1400)}#${hash(ref)}`;
}

/**
 * The refs a given page answers to. A backlink query asks the reverse index
 * for each of these, because a link may have named the page by id or by title
 * and both are correct.
 */
export function refsForPage({ id, spaceKey, title }) {
  const refs = [];
  if (id) refs.push(`id:${id}`);
  if (title) refs.push(`ttl:${fold(spaceKey)}:${fold(title)}`);
  return refs;
}

/**
 * The key of one edge row. Prefixed by the source page so that every edge a
 * page owns can be found and retracted when the page is re-read, and suffixed
 * by a hash of the link so two different links from the same page never
 * collide.
 */
export function edgeKey(sourceId, link) {
  const key = `${sourceId}.${hash(identity(link))}`;
  if (!SAFE_KEY.test(key) || key.length > MAX_KEY) {
    // Unreachable with a numeric page id, and an assertion rather than a
    // silent corruption if that assumption ever stops holding.
    throw new Error(`unusable edge key: ${key}`);
  }
  return key;
}

/** Drop what must not be stored: undefined, null, and the empty string. */
export function compact(row) {
  const out = {};
  for (const [k, v] of Object.entries(row)) {
    if (v === undefined || v === null) continue;
    if (typeof v === 'string' && v.trim() === '') continue;
    out[k] = v;
  }
  return out;
}

/**
 * An edge, ready to store.
 *
 * `state` is always present because the broken-links report partitions on it,
 * and a partition attribute that is sometimes missing is a row that can never
 * be found again.
 */
export function edgeRow({ source, link, state = 'new', at = 0 }) {
  return compact({
    sourceId: String(source.id),
    sourceSpace: fold(source.spaceKey) || 'unknown',
    sourceTitle: source.title,
    targetRef: targetRef(link, source.spaceKey),
    targetTitle: link.title,
    targetSpace: link.spaceKey,
    anchor: link.anchor,
    kind: link.kind,
    state,
    hits: int(link.count ?? 1, 1),
    seenAt: int(at),
  });
}

/**
 * How many headings of a page are remembered.
 *
 * A page's headings are kept so that a link to one of them can be checked. The
 * platform warns against attributes that grow without bound, and a generated
 * page can carry thousands of headings, so the list is capped. Past the cap the
 * app stops claiming it can check that page's anchors rather than storing a
 * truncated list and calling live anchors broken.
 */
export const MAX_ANCHORS = 300;

/** A page, ready to store. */
export function pageRow({
  spaceKey, title, version, anchors,
  inCount, outCount, brokenCount, at = 0,
}) {
  const folded = [...new Set((anchors ?? []).map(fold).filter(Boolean))];
  return compact({
    spaceKey: fold(spaceKey) || 'unknown',
    title,
    titleFold: fold(title),
    version: int(version),
    inCount: int(inCount),
    outCount: int(outCount),
    brokenCount: int(brokenCount),
    indexedAt: int(at),
    anchors: folded.length > MAX_ANCHORS ? [] : folded,
    anchorsTruncated: folded.length > MAX_ANCHORS,
  });
}

/**
 * The states an edge can be in, and what each one means to a reader.
 *
 * These strings are stored, and they partition the report index, so they are
 * part of the app's data format: renaming one silently hides every row already
 * written under the old name.
 */
export const STATES = {
  new: 'not resolved yet',
  ok: 'lands on a page that exists',
  missing: 'names a page that does not exist',
  ambiguous: 'names a title more than one page in the space carries',
  anchormissing: 'the page exists, but the heading it points at is gone',
  external: 'leaves this site, and is not checked',
  unchecked: 'an attachment, which this app does not have permission to see',
};

/** The states a reader should be shown as problems, worst first. */
export const PROBLEM_STATES = ['missing', 'anchormissing', 'ambiguous'];

/** Guard against a typo becoming a partition value nobody can query for. */
export function assertState(state) {
  if (!Object.hasOwn(STATES, state)) throw new Error(`unknown edge state: ${state}`);
  return state;
}
