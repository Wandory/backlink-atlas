/*
 * The graph, on Forge storage.
 *
 * Everything the crawler and the reports need from storage lives here, so that
 * the logic above can be tested against a plain Map and this file stays the
 * only place that knows the platform's shape.
 *
 * Two platform facts run through all of it:
 *   - a batch takes at most 25 keys, so every bulk write is chunked;
 *   - a query returns a page at a time, so every list is drained with a cursor
 *     and a hard ceiling. An unbounded drain is how an app gets suspended.
 */

import { kvs, WhereConditions } from '@forge/kvs';

const PAGE = 'page';
const EDGE = 'edge';

/** The platform's batch ceiling. */
const BATCH = 25;
/** How much of one query this app will ever pull. */
const MAX_ROWS = 5000;
const PER_QUERY = 100;

/** Split a list into batches the platform will accept. Exported to be tested. */
export const chunk = (list, size = BATCH) => {
  const out = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
};

/**
 * A batch write either worked or it did not, and the difference is only in the
 * result.
 *
 * `batchSet` reports per-key failures rather than throwing. Ignoring that is how
 * an entire phase of the sweep wrote nothing at all while every log stayed
 * silent and every counter looked plausible — an attribute the entity had not
 * declared was refused, key by key, and nobody asked.
 */
export function checkBatch(result, what) {
  const failed = result?.failedKeys ?? [];
  if (failed.length === 0) return result;
  // The failure carries a nested object; printing it plainly gives
  // "[object Object]", which is a message that helps nobody.
  const first = JSON.stringify(failed[0] ?? {}, (k, v) => (v instanceof Error ? String(v) : v));
  throw new Error(
    `${what}: storage refused ${failed.length} of them — ${String(first).slice(0, 400)}`,
  );
}

/**
 * A batch read, turned into a lookup by key.
 *
 * `batchGet` answers with `{ successfulKeys, failedKeys }`, not the `{ results }`
 * that most of the other APIs here use. Reading the wrong field yields an empty
 * map and no error at all — the writes that follow simply never happen, and the
 * only symptom is a report that stays empty forever. Exported so the shape is
 * pinned by a test rather than by memory.
 */
export function byKey(batch) {
  const rows = batch?.successfulKeys ?? [];
  return new Map(rows.map((row) => [String(row.key), row.value]));
}

/**
 * Drain a query, page by page, up to a ceiling.
 *
 * Returns the rows and whether there were more than the ceiling allowed. The
 * ceiling is the point: a query that follows cursors until they run out is how
 * an app reads a million rows and gets suspended, and it is a very easy loop to
 * write by accident. Exported so that behaviour can be tested rather than
 * assumed.
 */
export async function drain(build, { max = MAX_ROWS } = {}) {
  const rows = [];
  let cursor;
  let truncated = false;

  for (;;) {
    let query = build().limit(PER_QUERY);
    if (cursor) query = query.cursor(cursor);
    const { results, nextCursor } = await query.getMany();

    for (const r of results ?? []) rows.push({ key: r.key, ...(r.value ?? {}) });

    if (rows.length >= max) { truncated = Boolean(nextCursor); break; }
    if (!nextCursor) break;
    cursor = nextCursor;
  }

  return { rows: rows.slice(0, max), truncated };
}

/* ------------------------------- pages ---------------------------------- */

export const savePage = (id, row) => kvs.entity(PAGE).set(String(id), row);

export async function loadPage(id) {
  const value = await kvs.entity(PAGE).get(String(id));
  return value ? { id: String(id), ...value } : null;
}

export const deletePage = (id) => kvs.entity(PAGE).delete(String(id));

/** Every page in a space carrying exactly this folded title. */
export async function findByTitle(spaceFold, titleFold) {
  if (!spaceFold || !titleFold) return [];
  const { rows } = await drain(
    () => kvs.entity(PAGE).query()
      .index('by-space-title', { partition: [spaceFold] })
      .where(WhereConditions.equalTo(titleFold)),
    { max: 25 },
  );
  return rows.map((r) => ({ ...r, id: r.key }));
}

/** Pages of a space, in title order, a page of results at a time. */
export async function listSpacePages(spaceFold, { cursor, limit = 50 } = {}) {
  let query = kvs.entity(PAGE).query()
    .index('by-space-title', { partition: [spaceFold] })
    .limit(limit);
  if (cursor) query = query.cursor(cursor);
  const { results, nextCursor } = await query.getMany();
  return {
    items: (results ?? []).map((r) => ({ id: r.key, ...(r.value ?? {}) })),
    cursor: nextCursor ?? null,
  };
}

/** Pages in a space that nothing links to. */
export async function orphansIn(spaceFold, { max = 200 } = {}) {
  const { rows, truncated } = await drain(
    () => kvs.entity(PAGE).query()
      .index('by-space-incoming', { partition: [spaceFold] })
      .where(WhereConditions.equalTo(0)),
    { max },
  );
  return { items: rows.map((r) => ({ id: r.key, ...r })), truncated };
}

export async function setPageProblems(id, brokenCount) {
  const row = await kvs.entity(PAGE).get(String(id));
  if (!row) return;
  await kvs.entity(PAGE).set(String(id), { ...row, brokenCount });
}

/**
 * Add to pages' incoming counts.
 *
 * Read-modify-write, deliberately without a transaction: the sweep resets every
 * count to zero before it starts counting, so a lost increment is corrected by
 * the next sweep rather than compounding. Locking every popular page for the
 * duration would cost far more than it is worth.
 */
export async function addIncoming(entries) {
  for (const group of chunk(entries)) {
    const keys = group.map(([id]) => ({ entityName: PAGE, key: String(id) }));
    const current = byKey(await kvs.batchGet(keys));

    const writes = [];
    for (const [id, n] of group) {
      const row = current.get(String(id));
      if (!row) continue;
      writes.push({
        entityName: PAGE,
        key: String(id),
        value: { ...row, inCount: (row.inCount ?? 0) + n },
      });
    }
    if (writes.length) checkBatch(await kvs.batchSet(writes), 'counting incoming links');
  }
}

/* -------------------------------- edges --------------------------------- */

/** Everything one page points at. */
export async function loadEdges(sourceId) {
  const { rows } = await drain(
    () => kvs.entity(EDGE).query().index('by-source', { partition: [String(sourceId)] }),
    { max: 1000 },
  );
  return rows;
}

/**
 * Replace a page's edges wholesale.
 *
 * Retracting first is what stops a deleted link from haunting the index: a page
 * that used to link to the runbook and no longer does must stop appearing in
 * the runbook's backlinks the moment it is re-read.
 */
export async function replaceEdges(sourceId, rows) {
  const existing = await loadEdges(sourceId);
  const wanted = new Set(rows.map((r) => r.key));

  const stale = existing.map((e) => e.key).filter((k) => !wanted.has(k));
  for (const group of chunk(stale)) {
    await kvs.batchDelete(group.map((key) => ({ entityName: EDGE, key })));
  }

  for (const group of chunk(rows)) {
    checkBatch(await kvs.batchSet(group.map(({ key, row }) => ({
      entityName: EDGE, key, value: row,
    }))), 'writing edges');
  }
}

/**
 * Write the verdicts the resolve phase reached.
 *
 * The caller hands over complete rows, so there is no read-back: one fewer
 * round trip, and one fewer place for a batch to come home empty.
 */
export async function saveEdgeStates(updates) {
  for (const group of chunk(updates)) {
    checkBatch(await kvs.batchSet(group.map(({ key, row }) => ({
      entityName: EDGE, key, value: row,
    }))), 'saving edge states');
  }
}

/**
 * The reverse index: every edge pointing at any of these references.
 *
 * A page answers to more than one reference — its id, and its title in its
 * space — because a link may have named it either way, so each is asked for and
 * the answers are merged.
 */
export async function edgesPointingAt(refs, { max = 500 } = {}) {
  const seen = new Map();
  let truncated = false;

  for (const ref of refs) {
    const { rows, truncated: cut } = await drain(
      () => kvs.entity(EDGE).query().index('by-target', { partition: [ref] }),
      { max },
    );
    truncated = truncated || cut;
    for (const row of rows) if (!seen.has(row.key)) seen.set(row.key, row);
  }

  return { rows: [...seen.values()], truncated };
}

/** Every edge in a space that is in one of the problem states. */
export async function edgesInState(spaceFold, state, { max = 500 } = {}) {
  const { rows, truncated } = await drain(
    () => kvs.entity(EDGE).query()
      .index('by-space-state', { partition: [spaceFold, state] }),
    { max },
  );
  return { rows, truncated };
}
