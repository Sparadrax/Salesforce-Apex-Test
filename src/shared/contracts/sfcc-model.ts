/** Row types matching the SFCC schema. SQL NULL is represented explicitly. */
export interface Org {
  id: string;
  hostName: string | null;
}

export interface Run {
  id: string;
  percentage: number | null;
  orgId: string;
  /** Date/time text; new writes should use UTC ISO 8601 consistently. */
  startTime: string | null;
}

export interface ApexClass {
  id: string;
  name: string | null;
  orgId: string;
}

export interface ApexTestClass {
  id: string;
  name: string | null;
  orgId: string;
}

export interface GlobalCoverage {
  apexClass: string;
  run: string;
  orgId: string;
  numLineCovered: number | null;
  numLineUncovered: number | null;
  readonly percentage: number | null;
}

export interface TestClassCoverage extends GlobalCoverage {
  apexTestClass: string;
}

export interface TestMethodCoverage extends TestClassCoverage {
  name: string;
}

/** Generated percentages must be omitted when inserting or updating coverage. */
export type GlobalCoverageInput = Omit<GlobalCoverage, 'percentage'>;
export type TestClassCoverageInput = Omit<TestClassCoverage, 'percentage'>;
export type TestMethodCoverageInput = Omit<TestMethodCoverage, 'percentage'>;
