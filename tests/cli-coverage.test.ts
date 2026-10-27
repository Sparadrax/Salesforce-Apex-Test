import assert from 'node:assert/strict';
import { test } from 'node:test';
import { LocalStore } from '../src/main/database/store';
import { parseDeployment } from '../src/main/features/orgs/parse-deployment';

const ORG = '00D000000000001EAA';
const APEX = '01p000000000001AAA';
const TEST = '01p000000000002AAA';
function report() {
  const record = (method: string, covered: number[]) => ({
    ApexClassOrTrigger: { Id: APEX, Name: 'Service' },
    ApexTestClass: { Id: '07M000000000001AAA', Name: 'ServiceTest' },
    TestMethodName: method,
    NumLinesCovered: covered.length,
    NumLinesUncovered: 4 - covered.length,
    Coverage: {
      coveredLines: covered,
      uncoveredLines: [1, 2, 3, 4].filter((line) => !covered.includes(line)),
    },
  });
  return {
    summary: { testsRan: 3, failing: 1, testRunId: 'cli-coverage-run' },
    tests: ['first', 'second', 'third'].map((method, index) => ({
      ApexClass: { Id: TEST, Name: 'ServiceTest' },
      MethodName: method,
      Outcome: index === 1 ? 'Fail' : 'Pass',
    })),
    coverage: {
      coverage: [{ id: APEX, name: 'Service', totalLines: 4, totalCovered: 3 }],
      records: [
        record('first', [1, 2]),
        record('second', [2, 3]),
        record('third', []),
      ],
    },
  };
}

test('native CLI records populate both dependent tables with line unions, remapped IDs and outcomes', () => {
  const store = new LocalStore(':memory:');
  try {
    const staged = store.orgs.prepareJson(
      JSON.stringify(report()),
      'report.json',
    );
    store.orgs.commit(staged.token, ORG, 'example.my.salesforce.com');
    const linked = store.coverage.coveringTests(ORG, 'cli-coverage-run', APEX);
    assert.equal(linked.classes.length, 1);
    assert.equal(linked.classes[0]?.id, TEST);
    assert.equal(linked.classes[0]?.percentage, 75);
    const methods = store.coverage.methods(
      ORG,
      'cli-coverage-run',
      APEX,
      TEST,
    ).methods;
    assert.deepEqual(
      methods.map((row) => [row.name, row.percentage, row.failed]),
      [
        ['first', 50, false],
        ['second', 50, true],
        ['third', 0, false],
      ],
    );
    assert.equal(
      store.coverage.coveringTests(ORG, 'another-run', APEX).classes.length,
      0,
    );
  } finally {
    store.close();
  }
});

test('zero-only native CLI coverage never establishes a covering test-class link', () => {
  const value = report();
  value.coverage.records = [value.coverage.records[2]!];
  const data = parseDeployment(JSON.stringify(value));
  assert.deepEqual(data.testClassCoverage, []);
  assert.deepEqual(data.testMethodCoverage, []);
});

test('native CLI attribution rejects invalid line sets, totals and duplicated methods', () => {
  let value = report();
  value.coverage.records[0]!.Coverage.coveredLines = [1, 1];
  assert.throws(
    () => parseDeployment(JSON.stringify(value)),
    /positive and unique/,
  );
  value = report();
  value.coverage.records[0]!.NumLinesCovered = 5;
  assert.throws(() => parseDeployment(JSON.stringify(value)), /class total/);
  value = report();
  value.coverage.records.push(value.coverage.records[0]!);
  assert.throws(() => parseDeployment(JSON.stringify(value)), /Duplicate/);
  value = report();
  value.coverage.records[0]!.Coverage.uncoveredLines = [2, 4];
  assert.throws(
    () => parseDeployment(JSON.stringify(value)),
    /both covered and uncovered/,
  );
});

test('native CLI attribution refuses ambiguous test names and missing outcomes', () => {
  const value = report();
  value.tests.push({
    ...value.tests[0]!,
    ApexClass: { Id: '01p000000000003AAA', Name: 'ServiceTest' },
  });
  assert.throws(() => parseDeployment(JSON.stringify(value)), /uniquely match/);
  value.tests.pop();
  value.coverage.records[0]!.TestMethodName = 'notExecuted';
  assert.throws(
    () => parseDeployment(JSON.stringify(value)),
    /absent from the test results/,
  );
});
