import { Worker } from 'node:worker_threads';
import type { TableSort } from '../../shared/contracts/table-sort';
import { tableCursor } from './sorted-page';
import type {
  ClassHistoryIdentity,
  CoverageHistory,
} from '../../shared/contracts/coverage-history';
import { historyRange } from '../features/coverage-history/repository';
import type {
  DatabaseApi,
  DatabaseStatus,
  LocalRecord,
  RecordPage,
} from '../../shared/contracts/database';
import type {
  DatabaseCommand,
  DatabaseResult,
  WorkerResponse,
} from './protocol';
import {
  batchInput,
  collectionName,
  pageInput,
  recordKey,
  MAX_BATCH_BYTES,
} from './validation';
import type {
  DeploymentPreview,
  ImportConfirmation,
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
import {
  hostName,
  importToken,
  orgCursor,
  orgId,
  ImportValidationError,
} from '../features/orgs/import-validation';

type Pending = {
  resolve: (value: DatabaseResult) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
};

/** One serial writer, with a bounded queue so imports cannot grow memory without limit. */
export class DatabaseClient implements DatabaseApi {
  private readonly worker: Worker;
  private readonly pending = new Map<number, Pending>();
  private sequence = 0;
  private stopped = false;
  private closing: Promise<void> | undefined;

  constructor(filename: string, workerFilename: string) {
    this.worker = new Worker(workerFilename, { workerData: { filename } });
    this.worker.on('message', (response: WorkerResponse) => {
      const request = this.pending.get(response.id);
      if (!request) return;
      clearTimeout(request.timer);
      this.pending.delete(response.id);
      if (response.ok) request.resolve(response.result);
      else request.reject(new Error(response.error));
    });
    this.worker.on('error', (error: unknown) =>
      this.fail(error instanceof Error ? error : new Error(String(error))),
    );
    this.worker.on('exit', () =>
      this.fail(new Error('Database worker has stopped')),
    );
  }

  private fail(error: Error): void {
    this.stopped = true;
    for (const request of this.pending.values()) {
      clearTimeout(request.timer);
      request.reject(error);
    }
    this.pending.clear();
  }

  private request(command: DatabaseCommand): Promise<DatabaseResult> {
    if (this.stopped || (this.closing && command.operation !== 'close')) {
      return Promise.reject(new Error('Database is unavailable'));
    }
    // At most 8 queued 1 MiB batches, plus bounded page responses.
    if (this.pending.size >= 8 && command.operation !== 'close') {
      return Promise.reject(
        new Error(
          `Database is busy; await pending requests (batch limit ${MAX_BATCH_BYTES} bytes)`,
        ),
      );
    }
    const id = ++this.sequence;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.fail(
          new Error('Database timed out; a pending write may have committed'),
        );
        void this.worker.terminate();
      }, 30000);
      this.pending.set(id, { resolve, reject, timer });
      try {
        this.worker.postMessage({ id, command });
      } catch (error) {
        clearTimeout(timer);
        this.pending.delete(id);
        reject(error);
      }
    });
  }

  async listOrgs(afterId: unknown, sort?: TableSort): Promise<OrgPage> {
    return (await this.request({
      operation: 'orgs:list',
      afterId: sort === undefined ? orgCursor(afterId) : tableCursor(afterId),
      sort,
    })) as OrgPage;
  }

  /** Only call with a path obtained from the native file picker, never renderer input. */
  async prepareOrgImport(
    filename: string,
    session = 'default',
    targetOrgId?: string,
  ): Promise<DeploymentPreview> {
    return (await this.request({
      operation: 'orgs:prepare',
      filename,
      session,
      targetOrgId,
    })) as DeploymentPreview;
  }

  async commitOrgImport(
    value: unknown,
    session = 'default',
  ): Promise<ImportReceipt> {
    if (
      !value ||
      typeof value !== 'object' ||
      !('token' in value) ||
      !('orgId' in value) ||
      !('hostName' in value)
    )
      throw new ImportValidationError('Invalid import confirmation.');
    const input: ImportConfirmation = {
      token: importToken(value.token),
      orgId: orgId(value.orgId),
      hostName: hostName(value.hostName),
    };
    return (await this.request({
      operation: 'orgs:commit',
      ...input,
      session,
    })) as ImportReceipt;
  }

  async discardOrgImport(token: unknown, session = 'default'): Promise<void> {
    await this.request({
      operation: 'orgs:discard',
      token: importToken(token),
      session,
    });
  }

  async getOrg(id: unknown): Promise<OrgSummary> {
    return (await this.request({
      operation: 'orgs:get',
      orgId: orgId(id),
    })) as OrgSummary;
  }
  async deleteOrg(id: unknown): Promise<boolean> {
    return (await this.request({
      operation: 'orgs:delete',
      orgId: orgId(id),
    })) as boolean;
  }
  async addOrg(value: unknown): Promise<OrgSummary> {
    if (
      !value ||
      typeof value !== 'object' ||
      !('id' in value) ||
      !('hostName' in value)
    )
      throw new ImportValidationError('Enter an org ID and hostname.');
    return (await this.request({
      operation: 'orgs:add',
      orgId: orgId(value.id),
      hostName: hostName(value.hostName),
    })) as OrgSummary;
  }
  async orgRuns(id: string, cursor?: RunCursor): Promise<RunPage> {
    return (await this.request({
      operation: 'orgs:runs',
      orgId: orgId(id),
      cursor,
    })) as RunPage;
  }
  async orgTests(
    id: string,
    runId: string,
    afterIndex = -1,
  ): Promise<TestPage> {
    return (await this.request({
      operation: 'orgs:tests',
      orgId: orgId(id),
      runId,
      afterIndex,
    })) as TestPage;
  }
  async orgCoverage(
    id: string,
    runId: string,
    afterId = '',
    sort?: TableSort,
  ): Promise<CoveragePage> {
    return (await this.request({
      operation: 'orgs:coverage',
      sort,
      orgId: orgId(id),
      runId,
      afterId,
    })) as CoveragePage;
  }
  async releaseOrgSession(session: string): Promise<void> {
    await this.request({ operation: 'orgs:release', session });
  }
  async coveringTests(
    id: string,
    runId: string,
    apexClass: string,
    afterId = '',
    sort?: TableSort,
  ): Promise<CoveringTestClassPage> {
    return (await this.request({
      operation: 'coverage:tests',
      sort,
      orgId: orgId(id),
      runId,
      apexClass,
      afterId,
    })) as CoveringTestClassPage;
  }
  async coveredMethods(
    id: string,
    runId: string,
    apexClass: string,
    testClass: string,
    afterName = '',
    sort?: TableSort,
  ): Promise<CoveredMethodPage> {
    return (await this.request({
      operation: 'coverage:methods',
      sort,
      orgId: orgId(id),
      runId,
      apexClass,
      testClass,
      afterName,
    })) as CoveredMethodPage;
  }

  async status(): Promise<DatabaseStatus> {
    return (await this.request({ operation: 'status' })) as DatabaseStatus;
  }
  async classHistoryIdentity(
    id: unknown,
    apexClass: unknown,
  ): Promise<ClassHistoryIdentity> {
    if (typeof apexClass !== 'string' || !apexClass || apexClass.length > 18)
      throw new ImportValidationError('Invalid Apex class.');
    return (await this.request({
      operation: 'history:identity',
      orgId: orgId(id),
      apexClass,
    })) as ClassHistoryIdentity;
  }
  async classHistory(
    id: string,
    apexClass: string,
    range: unknown,
  ): Promise<CoverageHistory> {
    return (await this.request({
      operation: 'history:query',
      orgId: orgId(id),
      apexClass,
      range: historyRange(range),
    })) as CoverageHistory;
  }

  async putBatch(collection: unknown, records: unknown): Promise<number> {
    return (await this.request({
      operation: 'putBatch',
      collection: collectionName(collection),
      records: batchInput(records),
    })) as number;
  }

  async list(request: unknown): Promise<RecordPage> {
    return (await this.request({
      operation: 'list',
      request: pageInput(request),
    })) as RecordPage;
  }

  async delete(collection: unknown, key: unknown): Promise<boolean> {
    return (await this.request({
      operation: 'delete',
      collection: collectionName(collection),
      key: recordKey(key),
    })) as boolean;
  }

  async get(collection: unknown, key: unknown): Promise<LocalRecord | null> {
    return (await this.request({
      operation: 'get',
      collection: collectionName(collection),
      key: recordKey(key),
    })) as LocalRecord | null;
  }

  close(): Promise<void> {
    this.closing ??= (async () => {
      try {
        if (!this.stopped) await this.request({ operation: 'close' });
      } finally {
        this.stopped = true;
        await this.worker.terminate();
      }
    })();
    return this.closing;
  }
}
