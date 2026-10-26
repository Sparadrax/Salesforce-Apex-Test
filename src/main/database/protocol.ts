import type {
  DatabaseStatus,
  LocalRecord,
  LocalRecordInput,
  RecordPage,
  RecordPageRequest,
} from '../../shared/contracts/database';
import type {
  DeploymentPreview,
  ImportReceipt,
  OrgPage,
  OrgSummary,
  RunCursor,
  RunPage,
  TestPage,
  CoveragePage,
  CoveringTestClassPage,
  CoveredMethodPage,
} from '../../shared/contracts/orgs';
import type {
  ClassHistoryIdentity,
  CoverageHistory,
  HistoryRange,
} from '../../shared/contracts/coverage-history';
import type { TableSort } from '../../shared/contracts/table-sort';

export type DatabaseCommand =
  | { operation: 'history:identity'; orgId: string; apexClass: string }
  | {
      operation: 'history:query';
      orgId: string;
      apexClass: string;
      range: HistoryRange;
    }
  | {
      operation: 'coverage:tests';
      sort?: TableSort | undefined;
      orgId: string;
      runId: string;
      apexClass: string;
      afterId: string;
    }
  | {
      operation: 'coverage:methods';
      sort?: TableSort | undefined;
      orgId: string;
      runId: string;
      apexClass: string;
      testClass: string;
      afterName: string;
    }
  | { operation: 'status' }
  | { operation: 'putBatch'; collection: string; records: LocalRecordInput[] }
  | { operation: 'list'; request: RecordPageRequest }
  | { operation: 'delete'; collection: string; key: string }
  | { operation: 'get'; collection: string; key: string }
  | { operation: 'orgs:list'; afterId: string; sort?: TableSort | undefined }
  | { operation: 'orgs:get'; orgId: string }
  | { operation: 'orgs:add'; orgId: string; hostName: string }
  | { operation: 'orgs:delete'; orgId: string }
  | { operation: 'orgs:runs'; orgId: string; cursor: RunCursor | undefined }
  | {
      operation: 'orgs:tests';
      orgId: string;
      runId: string;
      afterIndex: number;
    }
  | {
      operation: 'orgs:coverage';
      sort?: TableSort | undefined;
      orgId: string;
      runId: string;
      afterId: string;
    }
  | {
      operation: 'orgs:prepare';
      filename: string;
      session: string;
      targetOrgId: string | undefined;
    }
  | {
      operation: 'orgs:commit';
      token: string;
      orgId: string;
      hostName: string;
      session: string;
    }
  | { operation: 'orgs:discard'; token: string; session: string }
  | { operation: 'orgs:release'; session: string }
  | { operation: 'close' };

export type DatabaseResult =
  | ClassHistoryIdentity
  | CoverageHistory
  | CoveringTestClassPage
  | CoveredMethodPage
  | DatabaseStatus
  | OrgPage
  | OrgSummary
  | RunPage
  | TestPage
  | CoveragePage
  | DeploymentPreview
  | ImportReceipt
  | LocalRecord
  | RecordPage
  | number
  | boolean
  | null;
export type WorkerRequest = { id: number; command: DatabaseCommand };
export type WorkerResponse =
  | { id: number; ok: true; result: DatabaseResult }
  | { id: number; ok: false; error: string };
