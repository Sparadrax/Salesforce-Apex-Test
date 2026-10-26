import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const { values } = parseArgs({
  options: {
    date: { type: 'string', default: '2026-10-26' },
    run: { type: 'string', default: '50' },
    seed: { type: 'string', default: '20261026' },
    output: { type: 'string', default: 'deployment-demo-50-classes.json' },
    'coverage-offset': { type: 'string', default: '0' },
    'failure-period': { type: 'string', default: '17' },
  },
});
const seedValue = Number(values.seed);
const runNumber = Number(values.run);
const coverageOffset = Number(values['coverage-offset']);
const failurePeriod = Number(values['failure-period']);
if (
  !/^\d{4}-\d{2}-\d{2}$/.test(values.date) ||
  new Date(`${values.date}T14:00:00.000Z`).toISOString().slice(0, 10) !==
    values.date
)
  throw new Error('Invalid run date');
if (
  !Number.isSafeInteger(seedValue) ||
  !Number.isSafeInteger(runNumber) ||
  runNumber < 1 ||
  runNumber > 999999999999 ||
  !Number.isFinite(coverageOffset) ||
  Math.abs(coverageOffset) > 0.5 ||
  !Number.isInteger(failurePeriod) ||
  failurePeriod < 2
)
  throw new Error('Invalid generator settings');
if (!/^(?:history\/)?[a-zA-Z0-9._-]+\.json$/.test(values.output))
  throw new Error(
    'Output must be a JSON filename in examples or examples/history',
  );
const startDate = `${values.date}T14:00:00.000Z`;
let seed = seedValue;
function random() {
  seed = (Math.imul(1664525, seed) + 1013904223) >>> 0;
  return seed / 4294967296;
}
function salesforceId(prefix, index) {
  const base = prefix + String(index).padStart(12, '0');
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ012345';
  let suffix = '';
  for (let group = 0; group < 3; group++) {
    let mask = 0;
    for (let i = 0; i < 5; i++)
      if (/[A-Z]/.test(base[group * 5 + i])) mask |= 1 << i;
    suffix += alphabet[mask];
  }
  return base + suffix;
}
const methodNames = [
  'testCreate',
  'testUpdate',
  'testDelete',
  'testPermissions',
  'testBulkOperations',
  'testErrorHandling',
];
const classes = Array.from({ length: 50 }, (_, i) => ({
  id: salesforceId('01p', i + 1),
  name: `DemoService${String(i + 1).padStart(3, '0')}`,
  total: 100 + i * 7,
}));
const tests = classes.map((entry, i) => ({
  id: salesforceId('01p', i + 1001),
  name: `${entry.name}Test`,
  methods: methodNames.slice(0, 4 + (i % 3)),
}));
const successes = [];
const failures = [];
let methodIndex = 0;
for (const test of tests) {
  for (const methodName of test.methods) {
    methodIndex++;
    const entry = {
      id: test.id,
      name: test.name,
      methodName,
      time: Number((8 + random() * 220).toFixed(2)),
      namespace: '',
    };
    if (methodIndex % failurePeriod === 0)
      failures.push({
        ...entry,
        message: `System.AssertException: Synthetic assertion failure in ${test.name}.${methodName}`,
        stackTrace: `Class.${test.name}.${methodName}: line 42, column 1`,
      });
    else successes.push(entry);
  }
}
const codeCoverage = [];
const testClassCoverage = [];
const testMethodCoverage = [];
for (const [index, apex] of classes.entries()) {
  const covered = Math.floor(
    apex.total *
      Math.min(
        0.99,
        Math.max(0.05, 0.55 + (index % 9) * 0.05 + coverageOffset),
      ),
  );
  const coveringTests = [tests[index], tests[(index + 1) % tests.length]];
  const entries = coveringTests.flatMap((test) =>
    test.methods.map((name) => ({ test, name, lines: new Set() })),
  );
  for (let line = 1; line <= covered; line++) {
    entries[(line + index) % entries.length].lines.add(line);
    for (const entry of entries) if (random() < 0.18) entry.lines.add(line);
  }
  codeCoverage.push({
    id: apex.id,
    name: apex.name,
    namespace: '',
    numLocations: String(apex.total),
    numLocationsNotCovered: String(apex.total - covered),
    locationsNotCovered: Array.from(
      { length: apex.total - covered },
      (_, i) => ({
        line: covered + i + 1,
        column: 0,
        numExecutions: 0,
        time: 0,
      }),
    ),
  });
  for (const test of coveringTests) {
    const union = new Set();
    for (const entry of entries.filter((row) => row.test.id === test.id)) {
      for (const line of entry.lines) union.add(line);
      testMethodCoverage.push({
        name: entry.name,
        apexClass: apex.id,
        apexTestClass: test.id,
        numLineCovered: entry.lines.size,
        numLineUncovered: apex.total - entry.lines.size,
      });
    }
    testClassCoverage.push({
      apexClass: apex.id,
      apexTestClass: test.id,
      numLineCovered: union.size,
      numLineUncovered: apex.total - union.size,
    });
  }
}
const totalTime = [...successes, ...failures].reduce(
  (sum, row) => sum + row.time,
  0,
);
const json = {
  _fixture: {
    description:
      'Synthetic local test data. No real org, credentials, or production data.',
    generator: 'scripts/generate-demo-deployment.mjs',
    seed: seedValue,
    runDate: values.date,
    coverageOffset,
    failurePeriod,
    apexClasses: 50,
    testClasses: 50,
    methods: methodIndex,
    passing: successes.length,
    failing: failures.length,
    detailFormat:
      'sfccCoverage version 1 is an application-specific test-data extension, not a Salesforce Metadata API field.',
  },
  status: failures.length ? 1 : 0,
  orgId: '00D000000000001EAA',
  hostName: 'apex-demo.my.salesforce.com',
  result: {
    id: salesforceId('0Af', runNumber),
    done: true,
    success: failures.length === 0,
    status: failures.length ? 'Failed' : 'Succeeded',
    startDate,
    completedDate: new Date(Date.parse(startDate) + 180000).toISOString(),
    numberTestsTotal: methodIndex,
    numberTestErrors: failures.length,
    details: {
      runTestResult: {
        numTestsRun: String(methodIndex),
        numFailures: String(failures.length),
        totalTime: Number(totalTime.toFixed(2)),
        successes,
        failures,
        codeCoverage,
        codeCoverageWarnings: [],
      },
    },
  },
  sfccCoverage: { version: 1, testClassCoverage, testMethodCoverage },
};
const destination = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  `../examples/${values.output}`,
);
fs.mkdirSync(path.dirname(destination), { recursive: true });
fs.writeFileSync(destination, JSON.stringify(json, null, 2) + '\n');
console.log(
  JSON.stringify({
    file: destination,
    classes: classes.length,
    testClasses: tests.length,
    methods: methodIndex,
    passing: successes.length,
    failing: failures.length,
    classLinks: testClassCoverage.length,
    methodLinks: testMethodCoverage.length,
    bytes: fs.statSync(destination).size,
  }),
);
