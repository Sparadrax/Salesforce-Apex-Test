import { createHash } from 'node:crypto';
import type { TestOutcome } from '../../../shared/contracts/orgs';
import {
  parseDetailedCoverage,
  type TestClassCoverageInput,
  type MethodCoverageInput,
} from './detailed-coverage';
import {
  ImportValidationError,
  text,
  orgId as validateOrgId,
} from './import-validation';

type JsonObject = Record<string, unknown>;
export interface DeploymentData {
  runId: string;
  orgId: string | null;
  hostName: string | null;
  startTime: string | null;
  status: string;
  classes: { id: string; name: string; covered: number; uncovered: number }[];
  testClasses: { id: string; name: string }[];
  testsRun: number;
  failures: number;
  tests: TestOutcome[];
  testClassCoverage: TestClassCoverageInput[];
  testMethodCoverage: MethodCoverageInput[];
}

function object(value: unknown, label: string): JsonObject {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new ImportValidationError(`${label} must be a JSON object.`);
  return value as JsonObject;
}

function optionalObject(value: unknown): JsonObject {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as JsonObject)
    : {};
}

function rows(value: unknown): unknown[] {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value : [value];
}

function count(value: unknown, label: string): number {
  const number =
    typeof value === 'string' && /^\d+$/.test(value) ? Number(value) : value;
  if (
    typeof number !== 'number' ||
    !Number.isSafeInteger(number) ||
    number < 0 ||
    number > 2147483647
  )
    throw new ImportValidationError(`${label} must be a nonnegative integer.`);
  return number;
}

function optionalText(
  value: unknown,
  label: string,
  max: number,
): string | null {
  return value === undefined || value === null || value === ''
    ? null
    : text(value, label, max);
}

/** Parse standard Metadata API DeployResult, CLI --json envelope, or CLI test report. */
export function parseDeployment(json: string): DeploymentData {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json.replace(/^\uFEFF/, ''));
  } catch {
    throw new ImportValidationError('The selected file is not valid JSON.');
  }
  const root = object(parsed, 'Deployment result');
  const result =
    root.result === undefined ? root : object(root.result, 'result');
  const summary = optionalObject(result.summary);
  const report = Object.keys(summary).length > 0 && Array.isArray(result.tests);
  const details = optionalObject(result.details);
  const runTests = report
    ? result
    : object(
        details.runTestResult,
        'details.runTestResult (export a completed deployment with test details)',
      );
  if (
    !report &&
    (result.done === false ||
      result.done === 'false' ||
      ['Pending', 'Queued', 'InProgress', 'Canceling'].includes(
        String(result.status),
      ))
  ) {
    throw new ImportValidationError(
      'This deployment is still running. Export the completed deployment report.',
    );
  }
  const classes = new Map<string, DeploymentData['classes'][number]>();
  const coverageContainer = optionalObject(result.coverage);
  const coverage = report
    ? (result.codecoverage ?? coverageContainer.coverage)
    : runTests.codeCoverage;
  for (const entry of rows(coverage)) {
    const row = object(entry, 'Code coverage entry');
    const id = text(
      report ? (row.apexId ?? row.id) : row.id,
      'Covered class ID',
      18,
    );
    const name = text(row.name, 'Covered class name', 180);
    const uncovered = count(
      report ? row.numLinesUncovered : row.numLocationsNotCovered,
      'Uncovered locations',
    );
    const covered =
      report && row.numLinesCovered !== undefined
        ? count(row.numLinesCovered, 'Covered locations')
        : count(
            report ? (row.totalLines ?? row.numLocations) : row.numLocations,
            'Total locations',
          ) - uncovered;
    if (covered < 0)
      throw new ImportValidationError(
        'Uncovered locations exceed total locations.',
      );
    if (classes.has(id))
      throw new ImportValidationError(
        'The file contains duplicate coverage entries for a class.',
      );
    classes.set(id, { id, name, covered, uncovered });
  }
  const tests = report
    ? rows(result.tests)
    : [...rows(runTests.successes), ...rows(runTests.failures)];
  const testClasses = new Map<string, DeploymentData['testClasses'][number]>();
  const outcomes: TestOutcome[] = [];
  const successCount = rows(runTests.successes).length;
  for (const [index, entry] of tests.entries()) {
    const row = object(entry, 'Test result');
    const apex = report ? object(row.ApexClass, 'Test ApexClass') : row;
    const id = text(report ? apex.Id : apex.id, 'Test class ID', 18);
    const name = text(report ? apex.Name : apex.name, 'Test class name', 180);
    const previous = testClasses.get(id);
    if (previous && previous.name !== name)
      throw new ImportValidationError(
        'The file contains conflicting test class names.',
      );
    testClasses.set(id, { id, name });
    const time = report ? row.RunTime : row.time;
    const duration =
      time === undefined || time === null || time === '' ? null : Number(time);
    outcomes.push({
      index,
      classId: id,
      className: name,
      methodName:
        typeof (report ? row.MethodName : row.methodName) === 'string'
          ? String(report ? row.MethodName : row.methodName).slice(0, 180)
          : '(unspecified)',
      outcome: report
        ? String(row.Outcome ?? 'Unknown').slice(0, 40)
        : index < successCount
          ? 'Pass'
          : 'Fail',
      duration:
        duration !== null && Number.isFinite(duration) && duration >= 0
          ? duration
          : null,
      message:
        typeof (report ? row.Message : row.message) === 'string'
          ? String(report ? row.Message : row.message).slice(0, 4096)
          : null,
    });
  }
  const testsRun = count(
    (report ? summary.testsRan : runTests.numTestsRun) ?? tests.length,
    'Tests run',
  );
  const failures = count(
    (report ? summary.failing : runTests.numFailures) ?? 0,
    'Test failures',
  );
  if (failures > testsRun)
    throw new ImportValidationError(
      'Test failures exceed the number of tests run.',
    );
  if (testsRun === 0 && classes.size === 0 && tests.length === 0)
    throw new ImportValidationError(
      'This file contains no test results or coverage to import.',
    );
  const dateValue = report
    ? summary.testStartTime
    : (result.startDate ?? result.createdDate);
  const date = optionalText(dateValue, 'Test start date', 100);
  if (date !== null && !Number.isFinite(Date.parse(date)))
    throw new ImportValidationError('The test start date is invalid.');
  const knownOrgId = optionalText(
    summary.orgId ?? result.orgId ?? root.orgId,
    'Org ID',
    18,
  );
  return {
    runId:
      optionalText(report ? summary.testRunId : result.id, 'Run ID', 180) ??
      `import-${createHash('sha256').update(json).digest('hex')}`,
    orgId: knownOrgId === null ? null : validateOrgId(knownOrgId),
    hostName: optionalText(
      summary.hostname ??
        result.hostname ??
        result.hostName ??
        root.hostname ??
        root.hostName,
      'Hostname',
      180,
    ),
    startTime: date === null ? null : new Date(date).toISOString(),
    status:
      optionalText(
        report ? summary.outcome : result.status,
        'Deployment status',
        100,
      ) ?? 'Completed',
    classes: [...classes.values()],
    testClasses: [...testClasses.values()],
    testsRun,
    failures,
    tests: outcomes,
    ...parseDetailedCoverage(root.sfccCoverage ?? result.sfccCoverage, {
      classes: [...classes.values()],
      testClasses: [...testClasses.values()],
      tests: outcomes,
    }),
  };
}
