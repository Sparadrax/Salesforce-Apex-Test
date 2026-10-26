import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import { LocalStore } from '../src/main/database/store';

function fixture() {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'apex-db-'));
  const filename = path.join(directory, 'test.sqlite');
  const store = new LocalStore(filename);
  return {
    filename,
    store,
    cleanup: () => {
      store.close();
      rmSync(directory, { recursive: true, force: true });
    },
  };
}

test('migrates, persists across reopen, and preserves IDs on upsert', () => {
  const f = fixture();
  try {
    assert.deepEqual(f.store.status(), {
      engine: 'sqlite',
      schemaVersion: 6,
      journalMode: 'wal',
    });
    f.store.putBatch('results', [{ key: 'one', json: '{"passed":true}' }]);
    const first = f.store.list({ collection: 'results' }).records[0]!;
    f.store.putBatch('results', [{ key: 'one', json: '{"passed":false}' }]);
    const second = new LocalStore(f.filename);
    try {
      const stored = second.list({ collection: 'results' }).records[0]!;
      assert.equal(stored.id, first.id);
      assert.equal(stored.json, '{"passed":false}');
    } finally {
      second.close();
    }
  } finally {
    f.cleanup();
  }
});

test('isolates collections, paginates without duplicates, handles SQL-like keys and deletes', () => {
  const f = fixture();
  try {
    f.store.putBatch(
      'results',
      Array.from({ length: 125 }, (_, i) => ({
        key: `key-${i}`,
        json: String(i),
      })),
    );
    f.store.putBatch('other', [
      { key: "'; DROP TABLE local_records; --", json: 'null' },
    ]);
    let afterId = 0;
    const ids: number[] = [];
    do {
      const page = f.store.list({ collection: 'results', afterId, limit: 17 });
      ids.push(...page.records.map((record) => record.id));
      if (page.nextCursor === null) break;
      afterId = page.nextCursor;
    } while (ids.length < 125);
    assert.equal(ids.length, 125);
    assert.equal(new Set(ids).size, 125);
    assert.equal(f.store.delete('results', 'key-0'), true);
    assert.equal(f.store.get('results', 'key-0'), null);
    assert.equal(f.store.get('results', 'key-1')?.json, '1');
    assert.equal(f.store.delete('results', 'key-0'), false);
    assert.equal(f.store.list({ collection: 'other' }).records.length, 1);
  } finally {
    f.cleanup();
  }
});

test('rolls back a whole batch when a later SQL write fails', () => {
  const f = fixture();
  const inspector = new DatabaseSync(f.filename);
  try {
    inspector.exec(
      "CREATE TRIGGER reject_record BEFORE INSERT ON local_records WHEN NEW.key = 'fail' BEGIN SELECT RAISE(ABORT, 'test failure'); END",
    );
    assert.throws(() =>
      f.store.putBatch('results', [
        { key: 'ok', json: '{}' },
        { key: 'fail', json: '{}' },
      ]),
    );
    assert.equal(f.store.list({ collection: 'results' }).records.length, 0);
  } finally {
    inspector.close();
    f.cleanup();
  }
});

test('rejects invalid JSON, oversized batches, unbounded pages and invalid cursors', () => {
  const f = fixture();
  try {
    assert.throws(() =>
      f.store.putBatch('bad name', [{ key: 'a', json: '{}' }]),
    );
    assert.throws(() => f.store.putBatch('results', [{ key: 'a', json: '{' }]));
    assert.throws(() =>
      f.store.putBatch('results', [
        { key: 'a', json: JSON.stringify('x'.repeat(65536)) },
      ]),
    );
    assert.throws(() =>
      f.store.putBatch(
        'results',
        Array.from({ length: 250 }, (_, i) => ({
          key: String(i),
          json: JSON.stringify('x'.repeat(5000)),
        })),
      ),
    );
    assert.throws(() =>
      f.store.list({ collection: 'results', limit: 1000000 }),
    );
    assert.throws(() => f.store.list({ collection: 'results', afterId: -1 }));
    assert.equal(f.store.list({ collection: 'results' }).records.length, 0);
  } finally {
    f.cleanup();
  }
});

test('refuses an unsupported future schema without resetting it', () => {
  const f = fixture();
  const inspector = new DatabaseSync(f.filename);
  try {
    inspector.exec('PRAGMA user_version = 99');
    assert.throws(() => new LocalStore(f.filename), /newer/);
    assert.equal(
      inspector.prepare('PRAGMA user_version').get()?.user_version,
      99,
    );
  } finally {
    inspector.close();
    f.cleanup();
  }
});

test('loads 100,000 records and uses an index for deep cursor pages', () => {
  const f = fixture();
  const started = performance.now();
  try {
    for (let offset = 0; offset < 100000; offset += 250) {
      f.store.putBatch(
        'results',
        Array.from({ length: 250 }, (_, i) => ({
          key: `result-${offset + i}`,
          json: JSON.stringify({ passed: true, duration: i }),
        })),
      );
    }
    const inspector = new DatabaseSync(f.filename);
    try {
      assert.equal(
        inspector.prepare('SELECT count(*) AS count FROM local_records').get()
          ?.count,
        100000,
      );
      const plan = inspector
        .prepare(
          'EXPLAIN QUERY PLAN SELECT id, key, json FROM local_records WHERE collection = ? AND id > ? ORDER BY id LIMIT ?',
        )
        .all('results', 99000, 50);
      assert.match(JSON.stringify(plan), /local_records_collection_id/);
      const page = f.store.list({
        collection: 'results',
        afterId: 99000,
        limit: 50,
      });
      assert.equal(page.records.length, 50);
      assert.equal(page.records[0]?.id, 99001);
      console.log(
        `100,000 records inserted and deep-page verified in ${Math.round(performance.now() - started)} ms`,
      );
    } finally {
      inspector.close();
    }
  } finally {
    f.cleanup();
  }
});
