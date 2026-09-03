import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { parse } from './helpers/yaml.js';

/*
 * The manifest and the code have to agree, and nothing checks that they do
 * until a deploy fails or, worse, a query silently returns nothing. A typo in
 * an index name is not a syntax error anywhere — it is a report that is empty
 * forever. These tests are the thing that notices.
 */

const manifest = parse(fs.readFileSync('manifest.yml', 'utf8'));
const source = Object.fromEntries(
  ['index', 'store', 'crawl', 'authz', 'graph', 'resolve', 'links']
    .map((name) => [name, fs.readFileSync(`src/${name}.js`, 'utf8')]),
);
const allSource = Object.values(source).join('\n');

describe('the functions the manifest promises', () => {
  const declared = manifest.modules.function;

  test('every handler names a module and an export', () => {
    for (const fn of declared) {
      assert.match(fn.handler, /^[a-z]+\.[a-zA-Z]+$/, `handler ${fn.handler}`);
    }
  });

  test('every handler exists as an export of the file it names', async () => {
    const entry = await import('../src/index.js');
    for (const fn of declared) {
      const [file, name] = fn.handler.split('.');
      assert.equal(file, 'index', `only src/index.js is wired up, not ${file}`);
      assert.ok(name in entry, `src/index.js does not export ${name}`);
      assert.notEqual(entry[name], undefined, `${name} is exported as undefined`);
    }
  });

  test('every module that names a function refers to one that is declared', () => {
    const keys = new Set(declared.map((f) => f.key));
    const named = [...JSON.stringify(manifest.modules).matchAll(/"function":"([^"]+)"/g)]
      .map((m) => m[1]);
    for (const name of named) {
      assert.ok(keys.has(name), `module refers to function "${name}", which is not declared`);
    }
  });

  test('the queue a consumer serves is the queue the code pushes to', () => {
    const [consumer] = manifest.modules.consumer;
    assert.match(source.index, new RegExp(`new Queue\\(\\{\\s*key:\\s*'${consumer.queue}'`),
      `no queue called "${consumer.queue}" is created in src/index.js`);
  });
});

describe('the storage the manifest defines', () => {
  const entities = manifest.app.storage.entities;
  const byName = new Map(entities.map((e) => [e.name, e]));

  test('the entities the code writes to are declared', () => {
    for (const name of ['page', 'edge']) {
      assert.ok(byName.has(name), `entity "${name}" is not declared`);
    }
  });

  test('every index the code queries exists in the manifest', () => {
    const declared = new Set(entities.flatMap((e) => e.indexes.map((i) => i.name)));
    const used = [...allSource.matchAll(/\.index\(\s*'([^']+)'/g)].map((m) => m[1]);
    assert.ok(used.length >= 5, 'expected the code to query several indexes');
    for (const name of used) {
      assert.ok(declared.has(name), `code queries index "${name}", which the manifest does not define`);
    }
  });

  test('every attribute an index partitions or ranges on is declared', () => {
    for (const entity of entities) {
      const attrs = new Set(Object.keys(entity.attributes));
      for (const index of entity.indexes) {
        for (const attr of [...(index.partition ?? []), ...(index.range ?? [])]) {
          assert.ok(attrs.has(attr),
            `index ${entity.name}.${index.name} uses "${attr}", which is not an attribute`);
        }
      }
    }
  });

  test('attribute names obey the platform pattern and length', () => {
    for (const entity of entities) {
      for (const name of Object.keys(entity.attributes)) {
        assert.match(name, /^[_A-Za-z][_0-9A-Za-z]*$/, `attribute ${entity.name}.${name}`);
        assert.ok(name.length <= 30, `attribute ${name} is longer than 30 characters`);
      }
    }
  });

  test('no entity exceeds the seven indexes the platform allows', () => {
    for (const entity of entities) {
      assert.ok(entity.indexes.length <= 7, `${entity.name} declares ${entity.indexes.length} indexes`);
    }
  });

  test('an index the code never uses is not carried around', () => {
    const used = new Set([...allSource.matchAll(/\.index\(\s*'([^']+)'/g)].map((m) => m[1]));
    for (const entity of entities) {
      for (const index of entity.indexes) {
        assert.ok(used.has(index.name),
          `index ${entity.name}.${index.name} is declared but never queried`);
      }
    }
  });
});

describe('permissions', () => {
  const scopes = manifest.permissions.scopes;

  test('nothing that writes to Confluence is asked for', () => {
    for (const scope of scopes) {
      assert.ok(!/^(write|delete|manage|admin):/.test(scope),
        `${scope} would let this app change the site, and it never needs to`);
    }
  });

  test('the scopes are exactly the three the app uses', () => {
    assert.deepEqual([...scopes].sort(),
      ['read:page:confluence', 'read:space:confluence', 'storage:app']);
  });

  test('no external permissions are declared, so nothing can be sent anywhere', () => {
    assert.equal(manifest.permissions.external, undefined,
      'declaring external permissions would let this app call out; it must not');
  });

  test('the app reads attachments nowhere, having not asked to', () => {
    assert.ok(!scopes.includes('read:attachment:confluence'));
    // And says so where a reader will see it, rather than silently ignoring them.
    assert.match(source.resolve, /does not ask for permission to read attachments/);
  });
});

describe('things that must not ship', () => {
  test('the app id is a real one, not the placeholder', () => {
    assert.ok(!/^ari:cloud:ecosystem::app\/0+-0+-0+-0+-0+$/.test(manifest.app.id),
      'manifest.yml still carries the placeholder app id — run forge register');
  });

  test('no secret is committed in the manifest', () => {
    const text = fs.readFileSync('manifest.yml', 'utf8');
    assert.ok(!/(ATATT|ATCTT)[A-Za-z0-9_-]{10,}/.test(text), 'an API token is in the manifest');
  });
});
