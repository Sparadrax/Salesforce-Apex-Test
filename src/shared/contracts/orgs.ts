import type { TableSort } from './table-sort';

export interface OrgSummary {
  id: string;
  hostName: string | null;
  runCount: number;
  lastRunAt: string | null;
  percentage: number | null;
}
export interface OrgPage {
  orgs: OrgSummary[];
  nextCursor: string | null;
}
export interface DeploymentPreview {
  token: string;
  sourceName: string;
  runId: string;
  orgId: string | null;
  hostName: string | null;
  startTime: string | null;
  status: string;
  classCount: number;
  testClassCount: number;
  testsRun: number;
  failures: number;
}
export interface ImportConfirmation {
  token: string;
  orgId: string;
  hostName: string;
}
export interface ImportReceipt {
  orgId: string;
  runId: string;
  classCount: number;
  testClassCount: number;
}
export type WindowContext =
  | { view: 'orgs' }
  | { view: 'org'; orgId: string }
  | { view: 'class-history'; orgId: string; apexClass: string };
export interface RunCursor {
  date: string;
  id: string;
}
export interface RunSummary {
  id: string;
  startTime: string | null;
  percentage: number | null;
  status: string | null;
  testsRun: number | null;
  failures: number | null;
}
export interface RunPage {
  runs: RunSummary[];
  nextCursor: RunCursor | null;
}
export interface TestOutcome {
  index: number;
  classId: string;
  className: string;
  methodName: string;
  outcome: string;
  duration: number | null;
  message: string | null;
}
export interface TestPage {
  tests: TestOutcome[];
  nextCursor: number | null;
}
export interface CoverageRow {
  id: string;
  name: string | null;
  covered: number | null;
  uncovered: number | null;
  percentage: number | null;
}
export interface CoveragePage {
  classes: CoverageRow[];
  nextCursor: string | null;
}
export interface CoveringTestClass {
  id: string;
  name: string | null;
  percentage: number | null;
}
export interface CoveringTestClassPage {
  classes: CoveringTestClass[];
  nextCursor: string | null;
}
export interface CoveredMethod {
  name: string;
  outcome: string | null;
  failed: boolean | null;
  percentage: number | null;
  message: string | null;
}
export interface CoveredMethodPage {
  methods: CoveredMethod[];
  nextCursor: string | null;
}
export interface OrgsApi {
  list(afterId?: string, sort?: TableSort): Promise<OrgPage>;
  add(input: { id: string; hostName: string }): Promise<OrgSummary>;
  /** Native confirmation is presented before any records are deleted. */
  remove(id: string): Promise<boolean>;
  open(id: string): Promise<void>;
  onChanged(callback: (orgId: string) => void): () => void;
}
export interface OrgRunsApi {
  openHistory(apexClass: string): Promise<void>;
  current(): Promise<OrgSummary>;
  list(cursor?: RunCursor): Promise<RunPage>;
  tests(runId: string, afterIndex?: number): Promise<TestPage>;
  coverage(
    runId: string,
    afterId?: string,
    sort?: TableSort,
  ): Promise<CoveragePage>;
  coveringTests(
    runId: string,
    apexClass: string,
    afterId?: string,
    sort?: TableSort,
  ): Promise<CoveringTestClassPage>;
  methods(
    runId: string,
    apexClass: string,
    testClass: string,
    afterName?: string,
    sort?: TableSort,
  ): Promise<CoveredMethodPage>;
  chooseImport(): Promise<DeploymentPreview | null>;
  confirmImport(token: string): Promise<ImportReceipt>;
  discardImport(token: string): Promise<void>;
  onChanged(callback: (orgId: string) => void): () => void;
}
