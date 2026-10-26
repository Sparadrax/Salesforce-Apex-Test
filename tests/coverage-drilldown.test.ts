import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import { LocalStore } from '../src/main/database/store';

const ORG = '00D000000000001EAA';
const OTHER = '00D000000000002EAA';
const APEX = '01p000000000001AAA';
const TEST = '01p000000000002AAA';
const RUN = '0Af000000000001AAA';
function fixture() {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'apex-drilldown-'));
  const filename = path.join(directory, 'application.sqlite');
  const store = new LocalStore(filename);
  const db = new DatabaseSync(filename);
  db.exec('PRAGMA foreign_keys = ON');
  const source = readFileSync(
    new URL('../examples/deployment-result.json', import.meta.url),
    'utf8',
  );
  const staged = store.orgs.prepareJson(source, 'result.json');
  store.orgs.commit(staged.token, ORG, 'example.my.salesforce.com');
  return {
    store,
    db,
    cleanup() {
      db.close();
      store.close();
      rmSync(directory, { recursive: true, force: true });
    },
  };
}

test('aggregate-only deployment data does not invent test-class or method attribution', () => {
  const f = fixture();
  try {
    assert.equal(f.store.orgs.coverage(ORG, RUN).classes[0]?.percentage, 80);
    assert.deepEqual(f.store.coverage.coveringTests(ORG, RUN, APEX), {
      classes: [],
      nextCursor: null,
    });
    assert.deepEqual(f.store.coverage.methods(ORG, RUN, APEX, TEST), {
      methods: [],
      nextCursor: null,
    });
  } finally {
    f.cleanup();
  }
});

test('drill-down returns the selected class contribution and combines method outcomes with coverage', () => {
  const f = fixture();
  try {
    f.db
      .prepare(
        'INSERT INTO TestClassCoverage(apexClass, apexTestClass, run, orgId, numLineCovered, numLineUncovered) VALUES (?, ?, ?, ?, 60, 40)',
      )
      .run(APEX, TEST, RUN, ORG);
    f.db
      .prepare(
        'INSERT INTO TestMethodCoverage(name, apexClass, apexTestClass, run, orgId, numLineCovered, numLineUncovered) VALUES (?, ?, ?, ?, ?, 30, 70)',
      )
      .run('testAccount', APEX, TEST, RUN, ORG);
    assert.equal(
      f.store.coverage.coveringTests(ORG, RUN, APEX).classes[0]?.percentage,
      60,
    );
    const first = f.store.coverage.methods(ORG, RUN, APEX, TEST).methods[0]!;
    assert.equal(first.name, 'testAccount');
    assert.equal(first.percentage, 30);
    assert.equal(first.failed, false);
    f.db
      .prepare(
        'INSERT INTO RunTestResult(run, orgId, testIndex, classId, className, methodName, outcome, message) VALUES (?, ?, 1, ?, ?, ?, ?, ?)',
      )
      .run(
        RUN,
        ORG,
        TEST,
        'AccountServiceTest',
        'testAccount',
        'Fail',
        'Assertion failed',
      );
    const retried = f.store.coverage.methods(ORG, RUN, APEX, TEST).methods[0]!;
    assert.equal(retried.failed, true);
    assert.equal(retried.message, 'Assertion failed');
    assert.equal(
      f.store.coverage.methods(ORG, RUN, 'different-class', TEST).methods
        .length,
      0,
    );
    assert.equal(
      f.store.coverage.coveringTests(OTHER, RUN, APEX).classes.length,
      0,
    );
    assert.equal(
      f.store.coverage.methods(OTHER, RUN, APEX, TEST).methods.length,
      0,
    );
  } finally {
    f.cleanup();
  }
});

test('missing outcome and missing percentage remain unknown, independently', () => {
  const f = fixture();
  try {
    f.db
      .prepare(
        'INSERT INTO TestMethodCoverage(name, apexClass, apexTestClass, run, orgId, numLineCovered, numLineUncovered) VALUES (?, ?, ?, ?, ?, 5, 5)',
      )
      .run('onlyCoverage', APEX, TEST, RUN, ORG);
    const linked = f.store.coverage.coveringTests(ORG, RUN, APEX).classes[0]!;
    assert.equal(linked.id, TEST);
    assert.equal(
      linked.percentage,
      null,
      'cannot infer class union from method counts',
    );
    const methods = f.store.coverage.methods(ORG, RUN, APEX, TEST).methods;
    assert.equal(
      methods.find((row) => row.name === 'onlyCoverage')?.failed,
      null,
    );
    assert.equal(
      methods.find((row) => row.name === 'onlyCoverage')?.percentage,
      50,
    );
    assert.equal(
      methods.find((row) => row.name === 'testAccount')?.failed,
      false,
    );
    assert.equal(
      methods.find((row) => row.name === 'testAccount')?.percentage,
      null,
    );
  } finally {
    f.cleanup();
  }
});

test('test-class and method cursors return bounded pages without duplicates, using scoped indexes', () => {
  const f = fixture();
  try {
    const add = f.db.prepare(
      'INSERT INTO ApexTestClass(id, name, orgId) VALUES (?, ?, ?)',
    );
    const link = f.db.prepare(
      'INSERT INTO TestClassCoverage(apexClass, apexTestClass, run, orgId, numLineCovered, numLineUncovered) VALUES (?, ?, ?, ?, 1, 1)',
    );
    const method = f.db.prepare(
      'INSERT INTO TestMethodCoverage(name, apexClass, apexTestClass, run, orgId, numLineCovered, numLineUncovered) VALUES (?, ?, ?, ?, ?, 1, 3)',
    );
    f.db.exec('BEGIN');
    for (let i = 0; i < 125; i++) {
      const id = `test-${i.toString().padStart(3, '0')}`;
      add.run(id, id, ORG);
      link.run(APEX, id, RUN, ORG);
      method.run(
        `method-${i.toString().padStart(3, '0')}`,
        APEX,
        'test-000',
        RUN,
        ORG,
      );
    }
    f.db.exec('COMMIT');
    const first = f.store.coverage.coveringTests(ORG, RUN, APEX);
    const second = f.store.coverage.coveringTests(
      ORG,
      RUN,
      APEX,
      first.nextCursor!,
    );
    const third = f.store.coverage.coveringTests(
      ORG,
      RUN,
      APEX,
      second.nextCursor!,
    );
    assert.equal(first.classes.length, 50);
    assert.equal(second.classes.length, 50);
    assert.equal(third.classes.length, 25);
    assert.equal(
      new Set(
        [...first.classes, ...second.classes, ...third.classes].map(
          (row) => row.id,
        ),
      ).size,
      125,
    );
    const one = f.store.coverage.methods(ORG, RUN, APEX, 'test-000');
    const two = f.store.coverage.methods(
      ORG,
      RUN,
      APEX,
      'test-000',
      one.nextCursor!,
    );
    const three = f.store.coverage.methods(
      ORG,
      RUN,
      APEX,
      'test-000',
      two.nextCursor!,
    );
    assert.equal(one.methods.length, 50);
    assert.equal(two.methods.length, 50);
    assert.equal(three.methods.length, 25);
    assert.equal(
      new Set(
        [...one.methods, ...two.methods, ...three.methods].map(
          (row) => row.name,
        ),
      ).size,
      125,
    );
    const plan = f.db
      .prepare(
        'EXPLAIN QUERY PLAN SELECT name FROM TestMethodCoverage WHERE orgId = ? AND run = ? AND apexClass = ? AND apexTestClass = ? AND name > ? ORDER BY name LIMIT 51',
      )
      .all(ORG, RUN, APEX, 'test-000', '');
    assert.match(JSON.stringify(plan), /TestMethodCoverage_drilldown/);
    assert.throws(() => f.store.coverage.coveringTests(ORG, RUN, APEX, 4));
  } finally {
    f.cleanup();
  }
});
