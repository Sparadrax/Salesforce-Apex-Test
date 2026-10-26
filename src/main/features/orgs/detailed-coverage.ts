import { ImportValidationError, text } from './import-validation';
import type { DeploymentData } from './parse-deployment';

export interface TestClassCoverageInput {
  apexClass: string;
  apexTestClass: string;
  numLineCovered: number;
  numLineUncovered: number;
}
export interface MethodCoverageInput extends TestClassCoverageInput {
  name: string;
}

/** Optional application fixture/export extension, not a standard Salesforce field. */
export function parseDetailedCoverage(
  value: unknown,
  data: Pick<DeploymentData, 'classes' | 'testClasses' | 'tests'>,
): {
  testClassCoverage: TestClassCoverageInput[];
  testMethodCoverage: MethodCoverageInput[];
} {
  if (value === undefined)
    return { testClassCoverage: [], testMethodCoverage: [] };
  if (
    !value ||
    typeof value !== 'object' ||
    !('version' in value) ||
    value.version !== 1
  )
    throw new ImportValidationError('sfccCoverage must use version 1.');
  const object = value as Record<string, unknown>;
  const classes = new Map(
    data.classes.map((row) => [row.id, row.covered + row.uncovered]),
  );
  const tests = new Set(data.testClasses.map((row) => row.id));
  const methods = new Set(
    data.tests.map((row) => JSON.stringify([row.classId, row.methodName])),
  );
  function read(
    field: string,
    method: boolean,
  ): (TestClassCoverageInput & { name?: string })[] {
    const rows = object[field] ?? [];
    if (!Array.isArray(rows))
      throw new ImportValidationError(
        `sfccCoverage.${field} must be an array.`,
      );
    const seen = new Set<string>();
    return rows.map((value: unknown) => {
      if (!value || typeof value !== 'object')
        throw new ImportValidationError(`Invalid sfccCoverage.${field} row.`);
      const row = value as Record<string, unknown>;
      const apexClass = text(row.apexClass, 'Coverage Apex class ID', 18);
      const apexTestClass = text(
        row.apexTestClass,
        'Coverage test class ID',
        18,
      );
      const covered = row.numLineCovered;
      const uncovered = row.numLineUncovered;
      if (!classes.has(apexClass) || !tests.has(apexTestClass))
        throw new ImportValidationError(
          'Detailed coverage references an unknown Apex class or test class.',
        );
      if (
        typeof covered !== 'number' ||
        typeof uncovered !== 'number' ||
        !Number.isSafeInteger(covered) ||
        !Number.isSafeInteger(uncovered) ||
        covered < 0 ||
        uncovered < 0 ||
        covered + uncovered !== classes.get(apexClass)
      )
        throw new ImportValidationError(
          'Detailed coverage counts must be nonnegative integers matching the Apex class total.',
        );
      const name = method ? text(row.name, 'Test method name', 180) : undefined;
      if (method && !methods.has(JSON.stringify([apexTestClass, name])))
        throw new ImportValidationError(
          'Detailed coverage references a method absent from the test results.',
        );
      const key = JSON.stringify([apexClass, apexTestClass, name]);
      if (seen.has(key))
        throw new ImportValidationError('Duplicate detailed coverage row.');
      seen.add(key);
      return name === undefined
        ? {
            apexClass,
            apexTestClass,
            numLineCovered: covered,
            numLineUncovered: uncovered,
          }
        : {
            apexClass,
            apexTestClass,
            name,
            numLineCovered: covered,
            numLineUncovered: uncovered,
          };
    });
  }
  return {
    testClassCoverage: read('testClassCoverage', false),
    testMethodCoverage: read(
      'testMethodCoverage',
      true,
    ) as MethodCoverageInput[],
  };
}
