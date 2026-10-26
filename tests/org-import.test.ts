import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import { LocalStore } from '../src/main/database/store';
import { parseDeployment } from '../src/main/features/orgs/parse-deployment';
import { hostName, orgId } from '../src/main/features/orgs/import-validation';

const source = readFileSync(
  new URL('../examples/deployment-result.json', import.meta.url),
  'utf8',
);
const ID = '00D000000000001EAA';
function fixture() {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'apex-org-import-'));
  const filename = path.join(directory, 'database.sqlite');
  const store = new LocalStore(filename);
  const inspector = new DatabaseSync(filename);
  return {
    store,
    inspector,
    directory,
    cleanup() {
      inspector.close();
      store.close();
      rmSync(directory, { recursive: true, force: true });
    },
  };
}

test('parses standard CLI and unwrapped Metadata API deployment results with singleton arrays and numeric strings', () => {
  const parsed = parseDeployment(source);
  assert.equal(parsed.orgId, null);
  assert.equal(parsed.hostName, null);
  assert.equal(parsed.classes[0]?.covered, 80);
  assert.equal(parsed.classes[0]?.uncovered, 20);
  assert.equal(parsed.testClasses[0]?.name, 'AccountServiceTest');
  const raw = JSON.parse(source).result;
  raw.details.runTestResult.codeCoverage =
    raw.details.runTestResult.codeCoverage[0];
  raw.details.runTestResult.successes = raw.details.runTestResult.successes[0];
  raw.orgId = ID;
  assert.equal(parseDeployment(JSON.stringify(raw)).orgId, ID);
  assert.equal(parseDeployment(JSON.stringify(raw)).classes.length, 1);
});

test('rejects malformed, incomplete, empty and invalid coverage without inventing records', () => {
  assert.throws(() => parseDeployment('{'), /valid JSON/);
  assert.throws(() => parseDeployment('{}'), /runTestResult/);
  assert.throws(() => parseDeployment('{"result":null}'), /object/);
  const raw = JSON.parse(source);
  raw.result.done = false;
  assert.throws(() => parseDeployment(JSON.stringify(raw)), /still running/);
  raw.result.done = true;
  raw.result.details.runTestResult.codeCoverage[0].numLocationsNotCovered = 101;
  assert.throws(() => parseDeployment(JSON.stringify(raw)), /exceed/);
  raw.result.details.runTestResult = { numTestsRun: 0, numFailures: 0 };
  assert.throws(() => parseDeployment(JSON.stringify(raw)), /no test results/);
});

test('supports Salesforce CLI test report JSON and preserves stable IDs when testRunId is omitted', () => {
  const report = JSON.stringify({
    summary: {
      orgId: ID,
      hostname: 'https://example.my.salesforce.com',
      testStartTime: '2026-10-26T10:00:00Z',
      testsRan: 1,
      failing: 0,
      outcome: 'Passed',
    },
    tests: [
      { ApexClass: { Id: '01p000000000002AAA', Name: 'AccountServiceTest' } },
    ],
    codecoverage: [
      {
        apexId: '01p000000000001AAA',
        name: 'AccountService',
        numLinesCovered: 80,
        numLinesUncovered: 20,
      },
    ],
  });
  const first = parseDeployment(report);
  assert.equal(first.orgId, ID);
  assert.equal(first.classes[0]?.covered, 80);
  assert.equal(first.runId, parseDeployment(report).runId);
});

test('imports relational data, retains the entire JSON, and reimports idempotently', () => {
  const f = fixture();
  try {
    const preview = f.store.orgs.prepareJson(source, 'deployment.json');
    assert.equal(
      f.store.orgs.list().orgs.length,
      0,
      'preview must not write any records',
    );
    f.store.orgs.commit(
      preview.token,
      ID,
      'https://EXAMPLE.my.salesforce.com/',
    );
    const page = f.store.orgs.list();
    assert.equal(page.orgs[0]?.hostName, 'example.my.salesforce.com');
    assert.equal(page.orgs[0]?.runCount, 1);
    assert.equal(page.orgs[0]?.percentage, 80);
    assert.equal(
      f.inspector.prepare('SELECT percentage FROM GlobalCoverage').get()
        ?.percentage,
      80,
    );
    assert.equal(
      f.inspector.prepare('SELECT name FROM ApexTestClass').get()?.name,
      'AccountServiceTest',
    );
    assert.deepEqual(
      JSON.parse(
        String(
          f.inspector.prepare('SELECT document FROM DeploymentImport').get()
            ?.document,
        ),
      ),
      JSON.parse(source),
    );
    assert.equal(
      f.inspector.prepare('SELECT count(*) AS n FROM TestClassCoverage').get()
        ?.n,
      0,
    );
    assert.equal(
      f.inspector.prepare('SELECT count(*) AS n FROM TestMethodCoverage').get()
        ?.n,
      0,
    );
    const repeat = f.store.orgs.prepareJson(source, 'deployment-again.json');
    f.store.orgs.commit(repeat.token, ID, 'example.my.salesforce.com');
    for (const table of [
      'Run',
      'GlobalCoverage',
      'ApexClass',
      'ApexTestClass',
      'DeploymentImport',
    ])
      assert.equal(
        f.inspector.prepare(`SELECT count(*) AS n FROM ${table}`).get()?.n,
        1,
      );
    assert.throws(
      () => f.store.orgs.commit(repeat.token, ID, 'example.my.salesforce.com'),
      /expired/,
    );
  } finally {
    f.cleanup();
  }
});

test('rejects org mismatch, validates hostnames and canonicalizes 15-character org IDs', () => {
  assert.equal(orgId('00D000000000001'), ID);
  assert.equal(
    hostName('https://example.my.salesforce.com/'),
    'example.my.salesforce.com',
  );
  for (const value of [
    'http://example.com',
    'https://user:password@example.com',
    'https://example.com/path',
    'javascript:alert(1)',
    'not a host',
  ])
    assert.throws(() => hostName(value));
  const f = fixture();
  try {
    const raw = JSON.parse(source);
    raw.result.orgId = ID;
    const staged = f.store.orgs.prepareJson(
      JSON.stringify(raw),
      'deployment.json',
    );
    assert.throws(
      () =>
        f.store.orgs.commit(
          staged.token,
          '00D000000000002EAA',
          'example.my.salesforce.com',
        ),
      /does not match/,
    );
    assert.equal(f.store.orgs.list().orgs.length, 0);
    f.store.orgs.commit(
      staged.token,
      '00D000000000001',
      'example.my.salesforce.com',
    );
    assert.equal(f.store.orgs.list().orgs[0]?.id, ID);
  } finally {
    f.cleanup();
  }
});

test('a write failure rolls back the entire import, and the preview remains retryable', () => {
  const f = fixture();
  try {
    f.inspector.exec(
      "CREATE TRIGGER reject_import BEFORE INSERT ON GlobalCoverage BEGIN SELECT RAISE(ABORT, 'failure'); END",
    );
    const staged = f.store.orgs.prepareJson(source, 'deployment.json');
    assert.throws(() =>
      f.store.orgs.commit(staged.token, ID, 'example.my.salesforce.com'),
    );
    for (const table of [
      'Org',
      'Run',
      'ApexClass',
      'ApexTestClass',
      'DeploymentImport',
    ])
      assert.equal(
        f.inspector.prepare(`SELECT count(*) AS n FROM ${table}`).get()?.n,
        0,
      );
    f.inspector.exec('DROP TRIGGER reject_import');
    f.store.orgs.commit(staged.token, ID, 'example.my.salesforce.com');
    assert.equal(f.store.orgs.list().orgs.length, 1);
  } finally {
    f.cleanup();
  }
});

test('file selection parses on the worker repository; discard and replacement invalidate old previews', () => {
  const f = fixture();
  try {
    const filename = path.join(f.directory, 'result.json');
    writeFileSync(filename, '\uFEFF' + source);
    const first = f.store.orgs.prepareFile(filename);
    assert.equal(first.sourceName, 'result.json');
    f.store.orgs.discard(first.token);
    assert.throws(
      () => f.store.orgs.commit(first.token, ID, 'example.my.salesforce.com'),
      /expired/,
    );
    const second = f.store.orgs.prepareFile(filename);
    const third = f.store.orgs.prepareFile(filename);
    assert.throws(
      () => f.store.orgs.commit(second.token, ID, 'example.my.salesforce.com'),
      /expired/,
    );
    f.store.orgs.commit(third.token, ID, 'example.my.salesforce.com');
    writeFileSync(filename, '');
    assert.throws(() => f.store.orgs.prepareFile(filename), /nonempty/);
  } finally {
    f.cleanup();
  }
});

test('org list uses bounded cursor pages and reports latest-run coverage', () => {
  const f = fixture();
  try {
    const insert = f.inspector.prepare(
      'INSERT INTO Org(id, hostName) VALUES (?, ?)',
    );
    for (let i = 0; i < 125; i++)
      insert.run(
        `org-${i.toString().padStart(3, '0')}`,
        `org-${i}.example.com`,
      );
    const first = f.store.orgs.list();
    assert.equal(first.orgs.length, 50);
    const second = f.store.orgs.list(first.nextCursor!);
    const third = f.store.orgs.list(second.nextCursor!);
    assert.equal(second.orgs.length, 50);
    assert.equal(third.orgs.length, 25);
    assert.equal(third.nextCursor, null);
    assert.equal(
      new Set(
        [...first.orgs, ...second.orgs, ...third.orgs].map((org) => org.id),
      ).size,
      125,
    );
  } finally {
    f.cleanup();
  }
});

test('failed deployments preserve failure details and run coverage is weighted by locations', () => {
  const f = fixture();
  try {
    const raw = JSON.parse(source);
    raw.status = 1;
    raw.result.status = 'Failed';
    raw.result.success = false;
    const tests = raw.result.details.runTestResult;
    tests.numTestsRun = 2;
    tests.numFailures = 1;
    tests.failures = [
      {
        id: '01p000000000003AAA',
        name: 'OtherTest',
        methodName: 'testFailure',
        message: 'Assertion failed',
        stackTrace: 'Class.OtherTest: line 12',
      },
    ];
    tests.codeCoverage.push({
      id: '01p000000000004AAA',
      name: 'OtherService',
      numLocations: 900,
      numLocationsNotCovered: 450,
    });
    const staged = f.store.orgs.prepareJson(JSON.stringify(raw), 'failed.json');
    assert.equal(staged.failures, 1);
    assert.equal(staged.testClassCount, 2);
    f.store.orgs.commit(staged.token, ID, 'example.my.salesforce.com');
    assert.equal(f.store.orgs.list().orgs[0]?.percentage, 53);
    const retained = JSON.parse(
      String(
        f.inspector.prepare('SELECT document FROM DeploymentImport').get()
          ?.document,
      ),
    );
    assert.equal(
      retained.result.details.runTestResult.failures[0].message,
      'Assertion failed',
    );
  } finally {
    f.cleanup();
  }
});

test('a test-only deployment imports without fabricating coverage', () => {
  const f = fixture();
  try {
    const raw = JSON.parse(source);
    delete raw.result.details.runTestResult.codeCoverage;
    const staged = f.store.orgs.prepareJson(
      JSON.stringify(raw),
      'tests-only.json',
    );
    f.store.orgs.commit(staged.token, ID, 'example.my.salesforce.com');
    assert.equal(f.store.orgs.list().orgs[0]?.percentage, null);
    assert.equal(
      f.inspector.prepare('SELECT count(*) AS n FROM GlobalCoverage').get()?.n,
      0,
    );
    assert.equal(
      f.inspector.prepare('SELECT count(*) AS n FROM ApexTestClass').get()?.n,
      1,
    );
  } finally {
    f.cleanup();
  }
});
