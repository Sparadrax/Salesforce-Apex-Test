import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { test } from 'node:test';
import { parseDeployment } from '../src/main/features/orgs/parse-deployment';
import { LocalStore } from '../src/main/database/store';
import { DatabaseSync } from 'node:sqlite';

const source = readFileSync(
  new URL('../examples/deployment-demo-50-classes.json', import.meta.url),
  'utf8',
);
test('demo file has 50 classes, 50 test classes and 4–6 outcomes per test class with consistent coverage', () => {
  const data = parseDeployment(source);
  assert.equal(data.classes.length, 50);
  assert.equal(data.testClasses.length, 50);
  assert.equal(data.tests.length, 249);
  assert.equal(data.failures, 14);
  for (const testClass of data.testClasses) {
    const methods = data.tests.filter((row) => row.classId === testClass.id);
    assert.ok(methods.length >= 4 && methods.length <= 6);
    assert.equal(
      new Set(methods.map((row) => row.methodName)).size,
      methods.length,
    );
  }
  assert.equal(data.testClassCoverage.length, 100);
  assert.equal(data.testMethodCoverage.length, 498);
  for (const row of data.testMethodCoverage) {
    const parent = data.testClassCoverage.find(
      (item) =>
        item.apexClass === row.apexClass &&
        item.apexTestClass === row.apexTestClass,
    )!;
    assert.ok(row.numLineCovered <= parent.numLineCovered);
    assert.equal(
      row.numLineCovered + row.numLineUncovered,
      parent.numLineCovered + parent.numLineUncovered,
    );
  }
});

test('demo imports and populates all three drill-down tables, including failed methods, without duplicates', () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'apex-demo-'));
  const store = new LocalStore(path.join(directory, 'application.sqlite'));
  try {
    const preview = store.orgs.prepareJson(source, 'demo.json');
    const receipt = store.orgs.commit(
      preview.token,
      '00D000000000001EAA',
      'apex-demo.my.salesforce.com',
    );
    assert.equal(receipt.classCount, 50);
    assert.equal(receipt.testClassCount, 50);
    const classes = store.orgs.coverage(receipt.orgId, receipt.runId);
    assert.equal(classes.classes.length, 50);
    let failed = 0;
    for (const apex of classes.classes) {
      const tests = store.coverage.coveringTests(
        receipt.orgId,
        receipt.runId,
        apex.id,
      );
      assert.equal(tests.classes.length, 2);
      for (const testClass of tests.classes) {
        assert.notEqual(testClass.percentage, null);
        const methods = store.coverage.methods(
          receipt.orgId,
          receipt.runId,
          apex.id,
          testClass.id,
        ).methods;
        assert.ok(methods.length >= 4 && methods.length <= 6);
        for (const method of methods) {
          assert.notEqual(method.percentage, null);
          assert.notEqual(method.failed, null);
          if (method.failed) failed++;
        }
      }
    }
    assert.equal(failed, 28); // Each failed method covers two different Apex classes.
    const repeat = store.orgs.prepareJson(source, 'demo.json');
    store.orgs.commit(
      repeat.token,
      receipt.orgId,
      'apex-demo.my.salesforce.com',
    );
    assert.equal(store.orgs.get(receipt.orgId).runCount, 1);
  } finally {
    store.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test('invalid detailed data is rejected before writing rows', () => {
  const fixture = JSON.parse(source);
  fixture.sfccCoverage.testMethodCoverage[0].apexTestClass = 'unknown';
  assert.throws(() => parseDeployment(JSON.stringify(fixture)), /unknown/);
  fixture.sfccCoverage.testMethodCoverage[0].apexTestClass =
    fixture.result.details.runTestResult.successes[0].id;
  fixture.sfccCoverage.testClassCoverage.push(
    fixture.sfccCoverage.testClassCoverage[0],
  );
  assert.throws(() => parseDeployment(JSON.stringify(fixture)), /Duplicate/);
});

test('upgrade recovers the three-table links from a JSON archived by an older build', () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'apex-detail-upgrade-'));
  const filename = path.join(directory, 'application.sqlite');
  try {
    const initial = new LocalStore(filename);
    const preview = initial.orgs.prepareJson(source, 'demo.json');
    const receipt = initial.orgs.commit(
      preview.token,
      '00D000000000001EAA',
      'apex-demo.my.salesforce.com',
    );
    initial.close();
    const legacy = new DatabaseSync(filename);
    legacy.exec(
      'DELETE FROM TestMethodCoverage; DELETE FROM TestClassCoverage; PRAGMA user_version = 5;',
    );
    const archived = legacy
      .prepare('SELECT document FROM DeploymentImport')
      .get()?.document;
    legacy.close();
    const recovered = new LocalStore(filename);
    try {
      assert.equal(recovered.status().schemaVersion, 6);
      const apex = recovered.orgs.coverage(receipt.orgId, receipt.runId)
        .classes[0]!;
      const tests = recovered.coverage.coveringTests(
        receipt.orgId,
        receipt.runId,
        apex.id,
      );
      assert.equal(tests.classes.length, 2);
      const methods = recovered.coverage.methods(
        receipt.orgId,
        receipt.runId,
        apex.id,
        tests.classes[0]!.id,
      );
      assert.ok(methods.methods.length >= 4 && methods.methods.length <= 6);
      assert.ok(
        methods.methods.every(
          (row) => row.percentage !== null && row.failed !== null,
        ),
      );
    } finally {
      recovered.close();
    }
    const inspector = new DatabaseSync(filename, { readOnly: true });
    try {
      assert.equal(
        inspector.prepare('SELECT count(*) AS n FROM TestClassCoverage').get()
          ?.n,
        100,
      );
      assert.equal(
        inspector.prepare('SELECT count(*) AS n FROM TestMethodCoverage').get()
          ?.n,
        498,
      );
      assert.equal(
        inspector.prepare('SELECT document FROM DeploymentImport').get()
          ?.document,
        archived,
      );
      assert.equal(
        inspector.prepare('SELECT count(*) AS n FROM Run').get()?.n,
        1,
      );
    } finally {
      inspector.close();
    }
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
