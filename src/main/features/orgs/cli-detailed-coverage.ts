import { ImportValidationError, text } from './import-validation';
import type { DeploymentData } from './parse-deployment';

type Details = Pick<DeploymentData, 'testClassCoverage' | 'testMethodCoverage'>;

/** CLI coverage.records includes line attribution; aggregate percentages cannot supply it. */
export function parseCliDetailedCoverage(
  records: unknown,
  data: Pick<DeploymentData, 'classes' | 'testClasses' | 'tests'>,
): Details {
  const result: Details = { testClassCoverage: [], testMethodCoverage: [] };
  if (records === undefined || records === null) return result;
  if (!Array.isArray(records))
    throw new ImportValidationError('coverage.records must be an array.');
  const classes = new Map(
    data.classes.map((row) => [row.id, row.covered + row.uncovered]),
  );
  const tests = new Map(data.testClasses.map((row) => [row.id, row]));
  const names = new Map<string, string[]>();
  for (const row of data.testClasses) {
    const ids = names.get(row.name) ?? [];
    ids.push(row.id);
    names.set(row.name, ids);
  }
  const methods = new Set(
    data.tests.map((row) => JSON.stringify([row.classId, row.methodName])),
  );
  const seen = new Set<string>();
  const groups = new Map<
    string,
    {
      apexClass: string;
      apexTestClass: string;
      total: number;
      covered: Set<number>;
    }
  >();
  const object = (value: unknown, label: string): Record<string, unknown> => {
    if (!value || typeof value !== 'object' || Array.isArray(value))
      throw new ImportValidationError(`${label} must be an object.`);
    return value as Record<string, unknown>;
  };
  const count = (value: unknown): number => {
    const number =
      typeof value === 'string' && /^\d+$/.test(value) ? Number(value) : value;
    if (
      typeof number !== 'number' ||
      !Number.isSafeInteger(number) ||
      number < 0 ||
      number > 2147483647
    )
      throw new ImportValidationError(
        'coverage.records counts must be nonnegative integers.',
      );
    return number;
  };
  const lines = (value: unknown, expected: number): Set<number> => {
    if (!Array.isArray(value) || value.length !== expected)
      throw new ImportValidationError(
        'coverage.records line arrays must match their counts.',
      );
    const unique = new Set<number>();
    for (const line of value) {
      const number = count(line);
      if (number === 0 || unique.has(number))
        throw new ImportValidationError(
          'coverage.records line numbers must be positive and unique.',
        );
      unique.add(number);
    }
    return unique;
  };
  for (const value of records) {
    const row = object(value, 'coverage.records entry');
    const apex = object(row.ApexClassOrTrigger, 'Coverage ApexClassOrTrigger');
    const test = object(row.ApexTestClass, 'Coverage ApexTestClass');
    const apexClass = text(apex.Id, 'Covered Apex class ID', 18);
    const total = classes.get(apexClass);
    if (total === undefined)
      throw new ImportValidationError(
        'coverage.records references an unknown covered Apex class.',
      );
    const testId = text(test.Id, 'Coverage test class ID', 18);
    const name = text(test.Name, 'Coverage test class name', 180);
    // Some CLI exports use 07M test IDs here and 01p IDs in tests[].ApexClass.
    // Only an exact ID or a unique name among this report's results establishes identity.
    const candidates = names.get(name) ?? [];
    const apexTestClass = tests.has(testId)
      ? testId
      : candidates.length === 1
        ? candidates[0]!
        : undefined;
    if (!apexTestClass || tests.get(apexTestClass)?.name !== name)
      throw new ImportValidationError(
        `Cannot uniquely match coverage test class ${name} to the test results.`,
      );
    const method = text(row.TestMethodName, 'Coverage test method', 180);
    if (!methods.has(JSON.stringify([apexTestClass, method])))
      throw new ImportValidationError(
        `Coverage method ${name}.${method} is absent from the test results.`,
      );
    const coveredCount = count(row.NumLinesCovered);
    const uncoveredCount = count(row.NumLinesUncovered);
    if (coveredCount + uncoveredCount !== total)
      throw new ImportValidationError(
        'coverage.records counts do not match the covered Apex class total.',
      );
    const coverage = object(row.Coverage, 'Coverage line attribution');
    const covered = lines(coverage.coveredLines, coveredCount);
    const uncovered = lines(coverage.uncoveredLines, uncoveredCount);
    for (const line of covered)
      if (uncovered.has(line))
        throw new ImportValidationError(
          'A coverage line cannot be both covered and uncovered.',
        );
    const key = JSON.stringify([apexClass, apexTestClass, method]);
    if (seen.has(key))
      throw new ImportValidationError(
        'Duplicate coverage.records method entry.',
      );
    seen.add(key);
    result.testMethodCoverage.push({
      name: method,
      apexClass,
      apexTestClass,
      numLineCovered: coveredCount,
      numLineUncovered: uncoveredCount,
    });
    // Preserve zero method percentages for linked classes, without creating all-zero links.
    if (coveredCount === 0) continue;
    const groupKey = JSON.stringify([apexClass, apexTestClass]);
    let group = groups.get(groupKey);
    if (!group) {
      group = { apexClass, apexTestClass, total, covered: new Set() };
      groups.set(groupKey, group);
    }
    for (const line of covered) group.covered.add(line);
    if (group.covered.size > total)
      throw new ImportValidationError(
        'Combined method coverage exceeds the Apex class total.',
      );
  }
  result.testMethodCoverage = result.testMethodCoverage.filter((row) =>
    groups.has(JSON.stringify([row.apexClass, row.apexTestClass])),
  );
  for (const group of groups.values())
    result.testClassCoverage.push({
      apexClass: group.apexClass,
      apexTestClass: group.apexTestClass,
      numLineCovered: group.covered.size,
      numLineUncovered: group.total - group.covered.size,
    });
  return result;
}
