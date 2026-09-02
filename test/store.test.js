import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { drain, chunk } from '../src/store.js';

/*
 * The two pieces of src/store.js that are logic rather than plumbing.
 *
 * Everything else in that file is a call into Forge storage and cannot run
 * outside it. These two can, and both are the kind of thing that fails quietly
 * and expensively: a batch one item too large is rejected, and a drain with no
 * ceiling reads until the app is suspended.
 */

/** A fake query builder that hands out pages and then stops. */
function fakeQuery(pages) {
  const calls = [];
  const build = () => {
    let limit = null;
    let cursor = null;
    const q = {
      limit(n) { limit = n; return q; },
      cursor(c) { cursor = c; return q; },
      async getMany() {
        calls.push({ limit, cursor });
        const at = cursor ? Number(cursor) : 0;
        return pages[at] ?? { results: [], nextCursor: null };
      },
    };
    return q;
  };
  return { build, calls };
}

/** n pages of m rows each, cursors pointing at the next page. */
const pagesOf = (count, per) => Array.from({ length: count }, (_, i) => ({
  results: Array.from({ length: per }, (_, j) => ({
    key: `k${i}-${j}`, value: { n: i * per + j },
  })),
  nextCursor: i + 1 < count ? String(i + 1) : null,
}));

describe('draining a query', () => {
  test('it follows cursors to the end and merges the pages', async () => {
    const { build, calls } = fakeQuery(pagesOf(3, 2));
    const { rows, truncated } = await drain(build);
    assert.equal(rows.length, 6);
    assert.equal(truncated, false);
    assert.equal(calls.length, 3);
  });

  test('the key and the value both come back on the row', async () => {
    const { build } = fakeQuery(pagesOf(1, 1));
    const { rows } = await drain(build);
    assert.deepEqual(rows[0], { key: 'k0-0', n: 0 });
  });

  test('it stops at the ceiling and says the answer is incomplete', async () => {
    const { build, calls } = fakeQuery(pagesOf(50, 10));
    const { rows, truncated } = await drain(build, { max: 25 });
    assert.equal(rows.length, 25);
    assert.equal(truncated, true, 'a cut-off answer must say it was cut off');
    assert.ok(calls.length < 50, `stopped after ${calls.length} calls rather than reading everything`);
  });

  test('a ceiling reached exactly on the last page is not called truncated', async () => {
    const { build } = fakeQuery(pagesOf(2, 5));
    const { rows, truncated } = await drain(build, { max: 10 });
    assert.equal(rows.length, 10);
    assert.equal(truncated, false);
  });

  test('an empty result is not an error', async () => {
    const { build } = fakeQuery([{ results: [], nextCursor: null }]);
    const { rows, truncated } = await drain(build);
    assert.deepEqual(rows, []);
    assert.equal(truncated, false);
  });

  test('a response missing its fields does not throw', async () => {
    const build = () => ({
      limit() { return this; },
      cursor() { return this; },
      async getMany() { return {}; },
    });
    const { rows } = await drain(build);
    assert.deepEqual(rows, []);
  });

  test('every page after the first carries the cursor it was given', async () => {
    const { build, calls } = fakeQuery(pagesOf(3, 1));
    await drain(build);
    assert.equal(calls[0].cursor, null);
    assert.equal(calls[1].cursor, '1');
    assert.equal(calls[2].cursor, '2');
  });

  test('a cursor that never ends still stops at the ceiling', async () => {
    // The failure this guards against: a store that always returns a cursor.
    const build = () => ({
      limit() { return this; },
      cursor() { return this; },
      async getMany() {
        return { results: [{ key: 'k', value: {} }], nextCursor: 'always' };
      },
    });
    const { rows, truncated } = await drain(build, { max: 40 });
    assert.equal(rows.length, 40);
    assert.equal(truncated, true);
  });
});

describe('batching', () => {
  test('nothing is split larger than the platform accepts', () => {
    const batches = chunk(Array.from({ length: 60 }, (_, i) => i));
    assert.deepEqual(batches.map((b) => b.length), [25, 25, 10]);
  });

  test('an empty list makes no batches, so no empty request is sent', () => {
    assert.deepEqual(chunk([]), []);
  });

  test('a list that fits exactly makes one batch', () => {
    assert.equal(chunk(Array.from({ length: 25 }, (_, i) => i)).length, 1);
  });
});
