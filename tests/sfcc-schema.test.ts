import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import { migrate } from '../src/main/database/migrations';
import { LocalStore } from '../src/main/database/store';

function database(): DatabaseSync {
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys = ON');
  migrate(db);
  return db;
}

function seed(db: DatabaseSync, orgId = 'org-a'): void {
  db.prepare('INSERT INTO Org(id, hostName) VALUES (?, ?)').run(
    orgId,
    'example.my.salesforce.com',
  );
  db.prepare(
    'INSERT INTO Run(id, orgId, percentage, startTime) VALUES (?, ?, ?, ?)',
  ).run('run-1', orgId, 75.5, '2026-10-26T12:00:00.000Z');
  db.prepare('INSERT INTO ApexClass(id, name, orgId) VALUES (?, ?, ?)').run(
    'class-1',
    'Example',
    orgId,
  );
  db.prepare('INSERT INTO ApexTestClass(id, name, orgId) VALUES (?, ?, ?)').run(
    'test-1',
    'ExampleTest',
    orgId,
  );
}

test('recreates all seven legacy tables, columns, and primary key orders', () => {
  const db = database();
  try {
    const expected = [
      { table: 'Org', columns: ['id', 'hostName'], pk: ['id'] },
      {
        table: 'Run',
        columns: ['id', 'percentage', 'orgId', 'startTime'],
        pk: ['id', 'orgId'],
      },
      {
        table: 'ApexClass',
        columns: ['id', 'name', 'orgId'],
        pk: ['id', 'orgId'],
      },
      {
        table: 'ApexTestClass',
        columns: ['id', 'name', 'orgId'],
        pk: ['id', 'orgId'],
      },
      {
        table: 'TestClassCoverage',
        columns: [
          'apexClass',
          'apexTestClass',
          'run',
          'orgId',
          'numLineCovered',
          'numLineUncovered',
          'percentage',
        ],
        pk: ['apexClass', 'apexTestClass', 'run', 'orgId'],
      },
      {
        table: 'GlobalCoverage',
        columns: [
          'apexClass',
          'run',
          'orgId',
          'numLineCovered',
          'numLineUncovered',
          'percentage',
        ],
        pk: ['apexClass', 'run', 'orgId'],
      },
      {
        table: 'TestMethodCoverage',
        columns: [
          'name',
          'apexClass',
          'apexTestClass',
          'run',
          'orgId',
          'numLineCovered',
          'numLineUncovered',
          'percentage',
        ],
        pk: ['name', 'apexClass', 'apexTestClass', 'run', 'orgId'],
      },
    ];
    for (const { table, columns, pk } of expected) {
      const fields = db
        .prepare('SELECT name, pk FROM pragma_table_xinfo(?)')
        .all(table);
      assert.deepEqual(
        fields.map((field) => field.name),
        columns,
      );
      assert.deepEqual(
        fields
          .filter((field) => Number(field.pk) > 0)
          .sort((a, b) => Number(a.pk) - Number(b.pk))
          .map((field) => field.name),
        pk,
      );
      const flags = db
        .prepare('SELECT strict, wr FROM pragma_table_list WHERE name = ?')
        .get(table)!;
      assert.equal(flags.strict, 1);
      assert.equal(flags.wr, 1);
    }
  } finally {
    db.close();
  }
});

test('coverage percentages are calculated, rounded, updated, nullable and read-only', () => {
  const db = database();
  try {
    seed(db);
    const tables = [
      { table: 'GlobalCoverage', extraColumns: '', extraValues: '' },
      {
        table: 'TestClassCoverage',
        extraColumns: ', apexTestClass',
        extraValues: ", 'test-1'",
      },
      {
        table: 'TestMethodCoverage',
        extraColumns: ', apexTestClass, name',
        extraValues: ", 'test-1', 'testMethod'",
      },
    ];
    for (const { table, extraColumns, extraValues } of tables) {
      db.exec(
        `INSERT INTO ${table}(apexClass, run, orgId, numLineCovered, numLineUncovered${extraColumns}) VALUES ('class-1', 'run-1', 'org-a', 1, 2${extraValues})`,
      );
      assert.equal(
        db.prepare(`SELECT percentage FROM ${table}`).get()?.percentage,
        33.33,
      );
      db.exec(`UPDATE ${table} SET numLineCovered = 3, numLineUncovered = 1`);
      assert.equal(
        db.prepare(`SELECT percentage FROM ${table}`).get()?.percentage,
        75,
      );
      db.exec(`UPDATE ${table} SET numLineCovered = 0, numLineUncovered = 0`);
      assert.equal(
        db.prepare(`SELECT percentage FROM ${table}`).get()?.percentage,
        null,
      );
      db.exec(
        `UPDATE ${table} SET numLineCovered = NULL, numLineUncovered = 10`,
      );
      assert.equal(
        db.prepare(`SELECT percentage FROM ${table}`).get()?.percentage,
        null,
      );
      assert.throws(
        () => db.exec(`UPDATE ${table} SET percentage = 50`),
        /generated/,
      );
    }
  } finally {
    db.close();
  }
});

test('composite keys allow identical IDs across orgs and prevent duplicates within an org', () => {
  const db = database();
  try {
    seed(db, 'org-a');
    seed(db, 'org-b');
    const write = db.prepare(
      'INSERT INTO TestMethodCoverage(name, apexClass, apexTestClass, run, orgId) VALUES (?, ?, ?, ?, ?)',
    );
    write.run('testMethod', 'class-1', 'test-1', 'run-1', 'org-a');
    write.run('testMethod', 'class-1', 'test-1', 'run-1', 'org-b');
    assert.throws(
      () => write.run('testMethod', 'class-1', 'test-1', 'run-1', 'org-a'),
      /UNIQUE/,
    );
    assert.equal(
      db.prepare('SELECT count(*) AS count FROM TestMethodCoverage').get()
        ?.count,
      2,
    );
    assert.throws(
      () =>
        db.exec("INSERT INTO ApexClass(id, orgId) VALUES ('class-1', 'org-a')"),
      /UNIQUE/,
    );
    assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), []);
  } finally {
    db.close();
  }
});

test('foreign keys reject missing and cross-org parents, and restrict referenced deletions', () => {
  const db = database();
  try {
    seed(db);
    db.exec("INSERT INTO Org(id) VALUES ('org-b')");
    assert.throws(
      () =>
        db.exec("INSERT INTO Run(id, orgId) VALUES ('missing', 'missing-org')"),
      /FOREIGN KEY/,
    );
    const cases = [
      { table: 'GlobalCoverage', columns: '', values: '' },
      {
        table: 'TestClassCoverage',
        columns: ', apexTestClass',
        values: ", 'test-1'",
      },
      {
        table: 'TestMethodCoverage',
        columns: ', apexTestClass, name',
        values: ", 'test-1', 'method'",
      },
    ];
    for (const { table, columns, values } of cases) {
      assert.throws(
        () =>
          db.exec(
            `INSERT INTO ${table}(apexClass, run, orgId${columns}) VALUES ('class-1', 'run-1', 'org-b'${values})`,
          ),
        /FOREIGN KEY/,
      );
      db.exec(
        `INSERT INTO ${table}(apexClass, run, orgId${columns}) VALUES ('class-1', 'run-1', 'org-a'${values})`,
      );
      assert.throws(
        () => db.exec(`UPDATE ${table} SET apexClass = 'missing'`),
        /FOREIGN KEY/,
      );
      assert.throws(
        () => db.exec(`UPDATE ${table} SET run = 'missing'`),
        /FOREIGN KEY/,
      );
      if (table !== 'GlobalCoverage')
        assert.throws(
          () => db.exec(`UPDATE ${table} SET apexTestClass = 'missing'`),
          /FOREIGN KEY/,
        );
    }
    for (const table of ['Org', 'Run', 'ApexClass', 'ApexTestClass']) {
      assert.throws(
        () =>
          db.exec(
            `DELETE FROM ${table} WHERE ${table === 'Org' ? 'id' : 'orgId'} = 'org-a'`,
          ),
        /FOREIGN KEY/,
      );
    }
  } finally {
    db.close();
  }
});

test('preserves optional fields while enforcing CHAR lengths, primary keys and strict numeric types', () => {
  const db = database();
  try {
    db.exec("INSERT INTO Org(id) VALUES ('org-a')");
    assert.equal(db.prepare('SELECT hostName FROM Org').get()?.hostName, null);
    assert.throws(
      () => db.exec('INSERT INTO Org(id) VALUES (NULL)'),
      /NOT NULL/,
    );
    assert.throws(
      () => db.prepare('INSERT INTO Org(id) VALUES (?)').run('x'.repeat(19)),
      /CHECK/,
    );
    assert.throws(
      () => db.prepare('UPDATE Org SET hostName = ?').run('x'.repeat(181)),
      /CHECK/,
    );
    db.exec("INSERT INTO Run(id, orgId) VALUES ('run', 'org-a')");
    assert.equal(
      db.prepare('SELECT startTime FROM Run').get()?.startTime,
      null,
    );
    assert.throws(
      () => db.exec("UPDATE Run SET percentage = 'invalid'"),
      /REAL/,
    );
  } finally {
    db.close();
  }
});

test('upgrades a v1 file without losing local records and can reopen the latest schema', () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'sfcc-upgrade-'));
  const filename = path.join(directory, 'application.sqlite');
  try {
    const old = new DatabaseSync(filename);
    old.exec(`CREATE TABLE local_records (
      id INTEGER PRIMARY KEY AUTOINCREMENT, collection TEXT NOT NULL,
      key TEXT NOT NULL, json TEXT NOT NULL CHECK(json_valid(json)),
      updated_at INTEGER NOT NULL, UNIQUE(collection, key)
    ) STRICT;
    CREATE INDEX local_records_collection_id ON local_records(collection, id);
    INSERT INTO local_records(collection, key, json, updated_at) VALUES ('settings', 'saved', '{"keep":true}', 1);
    PRAGMA user_version = 1;`);
    old.close();
    const store = new LocalStore(filename);
    try {
      assert.equal(store.status().schemaVersion, 6);
      assert.equal(store.get('settings', 'saved')?.json, '{"keep":true}');
    } finally {
      store.close();
    }
    const reopened = new LocalStore(filename);
    try {
      assert.equal(reopened.status().schemaVersion, 6);
    } finally {
      reopened.close();
    }
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('a failed schema upgrade rolls back its DDL and version together', () => {
  const db = new DatabaseSync(':memory:');
  try {
    db.exec('CREATE TABLE ApexClass (legacy TEXT); PRAGMA user_version = 1;');
    assert.throws(() => migrate(db), /already exists/);
    assert.equal(db.prepare('PRAGMA user_version').get()?.user_version, 1);
    assert.equal(
      db.prepare("SELECT name FROM sqlite_schema WHERE name = 'Org'").get(),
      undefined,
    );
    assert.ok(
      db
        .prepare("SELECT name FROM sqlite_schema WHERE name = 'ApexClass'")
        .get(),
    );
  } finally {
    db.close();
  }
});

test('100,000 method coverage rows support an indexed org/run query', () => {
  const db = database();
  try {
    seed(db);
    const insert = db.prepare(
      'INSERT INTO TestMethodCoverage(name, apexClass, apexTestClass, run, orgId, numLineCovered, numLineUncovered) VALUES (?, ?, ?, ?, ?, ?, ?)',
    );
    db.exec('BEGIN');
    for (let i = 0; i < 100000; i++)
      insert.run(
        `method-${i.toString().padStart(6, '0')}`,
        'class-1',
        'test-1',
        'run-1',
        'org-a',
        1,
        2,
      );
    db.exec('COMMIT');
    const sql =
      'SELECT name, percentage FROM TestMethodCoverage WHERE orgId = ? AND run = ? AND name > ? ORDER BY name LIMIT 50';
    const plan = db
      .prepare(`EXPLAIN QUERY PLAN ${sql}`)
      .all('org-a', 'run-1', 'method-099000');
    assert.match(JSON.stringify(plan), /TestMethodCoverage_org_run/);
    const page = db.prepare(sql).all('org-a', 'run-1', 'method-099000');
    assert.equal(page.length, 50);
    assert.equal(page[0]?.name, 'method-099001');
    assert.equal(page[0]?.percentage, 33.33);
  } finally {
    db.close();
  }
});
