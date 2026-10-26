import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import { LocalStore } from '../src/main/database/store';

const ORG = '00D000000000001EAA';
const OTHER = '00D000000000002EAA';
const tables = [
  'Org',
  'Run',
  'ApexClass',
  'ApexTestClass',
  'GlobalCoverage',
  'TestClassCoverage',
  'TestMethodCoverage',
  'DeploymentImport',
  'RunReport',
  'RunTestResult',
];
function fixture() {
  const folder = mkdtempSync(path.join(os.tmpdir(), 'apex-delete-'));
  const filename = path.join(folder, 'app.sqlite');
  const store = new LocalStore(filename);
  const db = new DatabaseSync(filename);
  db.exec('PRAGMA foreign_keys = ON');
  const source = readFileSync(
    new URL('../examples/deployment-demo-50-classes.json', import.meta.url),
    'utf8',
  );
  const staged = store.orgs.prepareJson(source, 'demo.json');
  store.orgs.commit(staged.token, ORG, 'apex-demo.my.salesforce.com');
  const other = JSON.parse(source);
  other.orgId = OTHER;
  const second = store.orgs.prepareJson(JSON.stringify(other), 'other.json');
  store.orgs.commit(second.token, OTHER, 'other.example.com');
  return {
    store,
    db,
    source,
    cleanup() {
      db.close();
      store.close();
      rmSync(folder, { recursive: true, force: true });
    },
  };
}

test('delete removes the org graph atomically, preserves other orgs/settings, and cancels its pending imports', () => {
  const f = fixture();
  try {
    f.store.putBatch('settings', [{ key: 'keep', json: 'true' }]);
    const pending = f.store.orgs.prepareJson(
      f.source,
      'pending.json',
      'org-window',
      ORG,
    );
    assert.equal(f.store.orgs.remove(ORG), true);
    for (const table of tables) {
      const column = table === 'Org' ? 'id' : 'orgId';
      assert.equal(
        f.db
          .prepare(`SELECT count(*) AS n FROM ${table} WHERE ${column} = ?`)
          .get(ORG)?.n,
        0,
      );
      assert.ok(
        Number(
          f.db
            .prepare(`SELECT count(*) AS n FROM ${table} WHERE ${column} = ?`)
            .get(OTHER)?.n,
        ) > 0,
      );
    }
    assert.equal(f.store.get('settings', 'keep')?.json, 'true');
    assert.throws(
      () =>
        f.store.orgs.commit(
          pending.token,
          ORG,
          'apex-demo.my.salesforce.com',
          'org-window',
        ),
      /expired/,
    );
    assert.equal(f.store.orgs.remove(ORG), false);
    assert.deepEqual(f.db.prepare('PRAGMA foreign_key_check').all(), []);
  } finally {
    f.cleanup();
  }
});

test('a deletion failure rolls back every removed child record', () => {
  const f = fixture();
  try {
    const before = tables.map(
      (table) => f.db.prepare(`SELECT count(*) AS n FROM ${table}`).get()?.n,
    );
    f.db.exec(
      "CREATE TRIGGER reject_delete BEFORE DELETE ON Org BEGIN SELECT RAISE(ABORT, 'rejected'); END",
    );
    assert.throws(() => f.store.orgs.remove(ORG), /rejected/);
    assert.deepEqual(
      tables.map(
        (table) => f.db.prepare(`SELECT count(*) AS n FROM ${table}`).get()?.n,
      ),
      before,
    );
  } finally {
    f.cleanup();
  }
});
