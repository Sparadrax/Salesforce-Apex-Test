import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import { sortedPage } from '../src/main/database/sorted-page';
import { LocalStore } from '../src/main/database/store';
import type { TableSort } from '../src/shared/contracts/table-sort';

test('sorted cursor pages cover the entire dataset, handle ties/nulls, and reject changed sorts or SQL columns', () => {
  const db = new DatabaseSync(':memory:');
  try {
    db.exec(
      'CREATE TABLE rows(id TEXT PRIMARY KEY, name TEXT, percentage REAL)',
    );
    const insert = db.prepare('INSERT INTO rows VALUES (?, ?, ?)');
    for (let i = 0; i < 125; i++)
      insert.run(
        `id-${String(i).padStart(3, '0')}`,
        `Name${125 - i}`,
        i % 11 === 0 ? null : i % 9,
      );
    const config = {
      columns: { percentage: 'percentage', name: 'name COLLATE NOCASE' },
      id: 'id',
      scope: 'fixture',
    };
    for (const direction of ['asc', 'desc'] as const) {
      const ids: string[] = [];
      let after = '';
      do {
        const page = sortedPage<{ id: string }>(
          db,
          'SELECT * FROM rows',
          [],
          after,
          { column: 'percentage', direction },
          config,
        );
        ids.push(...page.rows.map((row) => row.id));
        after = page.nextCursor ?? '';
      } while (after);
      const expected = db
        .prepare(
          `SELECT id FROM rows ORDER BY percentage ${direction} NULLS LAST, id ASC`,
        )
        .all()
        .map((row) => row.id);
      assert.deepEqual(ids, expected);
      assert.equal(new Set(ids).size, 125);
    }
    const first = sortedPage(
      db,
      'SELECT * FROM rows',
      [],
      '',
      { column: 'percentage', direction: 'asc' },
      config,
    );
    assert.throws(
      () =>
        sortedPage(
          db,
          'SELECT * FROM rows',
          [],
          first.nextCursor,
          { column: 'name', direction: 'asc' },
          config,
        ),
      /sort changed/,
    );
    assert.throws(
      () =>
        sortedPage(
          db,
          'SELECT * FROM rows',
          [],
          '',
          { column: 'name; DROP TABLE rows', direction: 'asc' },
          config,
        ),
      /Invalid table sort/,
    );
    assert.throws(
      () =>
        sortedPage(
          db,
          'SELECT * FROM rows',
          [],
          first.nextCursor,
          { column: 'percentage', direction: 'asc' },
          { ...config, scope: 'other' },
        ),
      /sort changed/,
    );
  } finally {
    db.close();
  }
});

test('all business tables sort globally beyond their first 50 rows', () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'apex-sorting-'));
  const filename = path.join(directory, 'app.sqlite');
  const store = new LocalStore(filename);
  const db = new DatabaseSync(filename);
  db.exec('PRAGMA foreign_keys = ON');
  const source = readFileSync(
    new URL('../examples/deployment-demo-50-classes.json', import.meta.url),
    'utf8',
  );
  const staged = store.orgs.prepareJson(source, 'demo.json');
  const receipt = store.orgs.commit(
    staged.token,
    '00D000000000001EAA',
    'apex-demo.my.salesforce.com',
  );
  const org = receipt.orgId;
  const run = receipt.runId;
  const apex = store.orgs.coverage(org, run).classes[0]!.id;
  const testClass = store.coverage.coveringTests(org, run, apex).classes[0]!.id;
  try {
    db.exec('BEGIN');
    for (let i = 0; i < 60; i++) {
      const id = `extra-${String(i).padStart(3, '0')}`;
      db.prepare('INSERT INTO ApexClass(id, orgId, name) VALUES (?, ?, ?)').run(
        id,
        org,
        `ZClass${i}`,
      );
      db.prepare(
        'INSERT INTO GlobalCoverage(apexClass, run, orgId, numLineCovered, numLineUncovered) VALUES (?, ?, ?, ?, ?)',
      ).run(id, run, org, i, 100 - i);
      db.prepare(
        'INSERT INTO ApexTestClass(id, orgId, name) VALUES (?, ?, ?)',
      ).run(id, org, `ZTest${i}`);
      db.prepare(
        'INSERT INTO TestClassCoverage(apexClass, apexTestClass, run, orgId, numLineCovered, numLineUncovered) VALUES (?, ?, ?, ?, ?, ?)',
      ).run(apex, id, run, org, i, 100 - i);
      db.prepare(
        'INSERT INTO TestMethodCoverage(name, apexClass, apexTestClass, run, orgId, numLineCovered, numLineUncovered) VALUES (?, ?, ?, ?, ?, ?, ?)',
      ).run(
        `extraMethod${String(i).padStart(3, '0')}`,
        apex,
        testClass,
        run,
        org,
        i,
        100 - i,
      );
      db.prepare(
        'INSERT INTO RunTestResult(run, orgId, testIndex, classId, className, methodName, outcome) VALUES (?, ?, ?, ?, ?, ?, ?)',
      ).run(
        run,
        org,
        1000 + i,
        testClass,
        'DemoTest',
        `extraMethod${String(i).padStart(3, '0')}`,
        i % 2 ? 'Pass' : 'Fail',
      );
      db.prepare('INSERT INTO Org(id, hostName) VALUES (?, ?)').run(
        `00D${String(i + 100).padStart(12, '0')}EAA`,
        `org-${String(60 - i).padStart(3, '0')}.example.com`,
      );
    }
    db.exec('COMMIT');
    function all<T>(
      fetch: (cursor: string) => { rows: T[]; nextCursor: string | null },
    ): T[] {
      const rows: T[] = [];
      let cursor = '';
      do {
        const page = fetch(cursor);
        rows.push(...page.rows);
        cursor = page.nextCursor ?? '';
      } while (cursor);
      return rows;
    }
    const score: TableSort = { column: 'percentage', direction: 'desc' };
    const classes = all((cursor) => {
      const page = store.orgs.coverage(org, run, cursor, score);
      return { rows: page.classes, nextCursor: page.nextCursor };
    });
    assert.equal(classes.length, 110);
    assert.ok(
      classes.every(
        (row, i) => i === 0 || classes[i - 1]!.percentage! >= row.percentage!,
      ),
    );
    const tests = all((cursor) => {
      const page = store.coverage.coveringTests(org, run, apex, cursor, score);
      return { rows: page.classes, nextCursor: page.nextCursor };
    });
    assert.equal(tests.length, 62);
    assert.ok(
      tests.every(
        (row, i) => i === 0 || tests[i - 1]!.percentage! >= row.percentage!,
      ),
    );
    const methods = all((cursor) => {
      const page = store.coverage.methods(
        org,
        run,
        apex,
        testClass,
        cursor,
        score,
      );
      return { rows: page.methods, nextCursor: page.nextCursor };
    });
    assert.ok(methods.length >= 64);
    assert.ok(
      methods.every(
        (row, i) => i === 0 || methods[i - 1]!.percentage! >= row.percentage!,
      ),
    );
    const failedFirst = store.coverage.methods(org, run, apex, testClass, '', {
      column: 'outcome',
      direction: 'asc',
    });
    assert.equal(failedFirst.methods[0]?.failed, true);
    const orgs = all((cursor) => {
      const page = store.orgs.list(cursor, {
        column: 'hostName',
        direction: 'desc',
      });
      return { rows: page.orgs, nextCursor: page.nextCursor };
    });
    assert.equal(orgs.length, 61);
    assert.equal(orgs[0]?.hostName, 'org-060.example.com');
  } finally {
    db.close();
    store.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
