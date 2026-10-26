import { randomUUID } from 'node:crypto';
import { openSync, closeSync, fstatSync, readSync } from 'node:fs';
import { Buffer } from 'node:buffer';
import path from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import type {
  DeploymentPreview,
  ImportReceipt,
  OrgPage,
  OrgSummary,
  RunCursor,
  RunPage,
  TestPage,
  CoveragePage,
} from '../../../shared/contracts/orgs';
import {
  hostName,
  importToken,
  ImportValidationError,
  orgCursor,
  orgId,
  text,
} from './import-validation';
import { parseDeployment, type DeploymentData } from './parse-deployment';
import { persistTestResults } from './persist-test-results';
import { persistDetailedCoverage } from './persist-detailed-coverage';
import { deleteOrganization } from './delete-org';
import type { TableSort } from '../../../shared/contracts/table-sort';
import { sortedPage } from '../../database/sorted-page';

export const MAX_IMPORT_BYTES = 64 * 1024 * 1024;
const PREVIEW_LIFETIME = 10 * 60 * 1000;
type PreparedImport = {
  token: string;
  expires: number;
  sourceName: string;
  json: string;
  data: DeploymentData;
  targetOrgId: string | undefined;
  timer: ReturnType<typeof setTimeout>;
  bytes: number;
};

/** Runs exclusively on the database worker, sharing its SQLite connection. */
export class OrgRepository {
  private readonly prepared = new Map<string, PreparedImport>();
  constructor(private readonly db: DatabaseSync) {}

  list(afterId: unknown = '', sort?: TableSort): OrgPage {
    if (sort !== undefined) {
      const page = sortedPage<OrgSummary>(
        this.db,
        `SELECT o.id, o.hostName,
        (SELECT count(*) FROM Run WHERE orgId = o.id) AS runCount,
        (SELECT startTime FROM Run WHERE orgId = o.id ORDER BY startTime DESC, id DESC LIMIT 1) AS lastRunAt,
        (SELECT percentage FROM Run WHERE orgId = o.id ORDER BY startTime DESC, id DESC LIMIT 1) AS percentage FROM Org o`,
        [],
        afterId,
        sort,
        {
          columns: { hostName: 'hostName COLLATE NOCASE' },
          id: 'id',
          scope: 'orgs',
        },
      );
      return { orgs: page.rows, nextCursor: page.nextCursor };
    }
    const cursor = orgCursor(afterId);
    const orgs = this.db
      .prepare(`
      SELECT o.id, o.hostName,
        (SELECT count(*) FROM Run r WHERE r.orgId = o.id) AS runCount,
        (SELECT startTime FROM Run r WHERE r.orgId = o.id ORDER BY startTime DESC, id DESC LIMIT 1) AS lastRunAt,
        (SELECT percentage FROM Run r WHERE r.orgId = o.id ORDER BY startTime DESC, id DESC LIMIT 1) AS percentage
      FROM Org o WHERE o.id > ? ORDER BY o.id LIMIT 51
    `)
      .all(cursor) as unknown as OrgPage['orgs'];
    const more = orgs.length > 50;
    if (more) orgs.pop();
    return { orgs, nextCursor: more ? orgs.at(-1)!.id : null };
  }

  get(idValue: unknown): OrgSummary {
    const id = orgId(idValue);
    const row = this.db
      .prepare(`SELECT o.id, o.hostName,
      (SELECT count(*) FROM Run WHERE orgId = o.id) AS runCount,
      (SELECT startTime FROM Run WHERE orgId = o.id ORDER BY COALESCE(startTime, '') DESC, id DESC LIMIT 1) AS lastRunAt,
      (SELECT percentage FROM Run WHERE orgId = o.id ORDER BY COALESCE(startTime, '') DESC, id DESC LIMIT 1) AS percentage
      FROM Org o WHERE o.id = ?`)
      .get(id) as unknown as OrgSummary | undefined;
    if (!row)
      throw new ImportValidationError('This organization does not exist.');
    return row;
  }

  add(idValue: unknown, hostnameValue: unknown): OrgSummary {
    const id = orgId(idValue);
    const hostname = hostName(hostnameValue);
    const result = this.db
      .prepare(
        'INSERT INTO Org(id, hostName) VALUES (?, ?) ON CONFLICT(id) DO NOTHING',
      )
      .run(id, hostname);
    if (!result.changes)
      throw new ImportValidationError(
        'This organization already exists. Open it from the list.',
      );
    return this.get(id);
  }
  remove(idValue: unknown): boolean {
    const id = orgId(idValue);
    const removed = deleteOrganization(this.db, id);
    if (removed)
      for (const [session, staged] of this.prepared) {
        if (staged.targetOrgId === id || staged.data.orgId === id)
          this.clearSession(session);
      }
    return removed;
  }

  runs(idValue: unknown, cursor?: RunCursor): RunPage {
    const id = orgId(idValue);
    if (
      cursor &&
      (typeof cursor !== 'object' ||
        typeof cursor.date !== 'string' ||
        cursor.date.length > 100 ||
        typeof cursor.id !== 'string' ||
        cursor.id.length > 180)
    )
      throw new ImportValidationError('Invalid run cursor.');
    const predicate = cursor
      ? "AND (COALESCE(r.startTime, ''), r.id) < (?, ?)"
      : '';
    const args = cursor ? [id, cursor.date, cursor.id] : [id];
    const runs = this.db
      .prepare(`SELECT r.id, r.startTime, r.percentage, s.status, s.testsRun, s.failures
      FROM Run r LEFT JOIN RunReport s ON s.run = r.id AND s.orgId = r.orgId
      WHERE r.orgId = ? ${predicate} ORDER BY COALESCE(r.startTime, '') DESC, r.id DESC LIMIT 51`)
      .all(...args) as unknown as RunPage['runs'];
    const more = runs.length > 50;
    if (more) runs.pop();
    const last = runs.at(-1);
    return {
      runs,
      nextCursor:
        more && last ? { date: last.startTime ?? '', id: last.id } : null,
    };
  }

  tests(idValue: unknown, runValue: unknown, afterIndex = -1): TestPage {
    const id = orgId(idValue);
    const run = text(runValue, 'Run ID', 180);
    if (!Number.isSafeInteger(afterIndex) || afterIndex < -1)
      throw new ImportValidationError('Invalid test cursor.');
    const tests = this.db
      .prepare(`SELECT testIndex AS "index", classId, className, methodName, outcome, duration, message
      FROM RunTestResult WHERE orgId = ? AND run = ? AND testIndex > ? ORDER BY testIndex LIMIT 51`)
      .all(id, run, afterIndex) as unknown as TestPage['tests'];
    const more = tests.length > 50;
    if (more) tests.pop();
    return { tests, nextCursor: more ? tests.at(-1)!.index : null };
  }

  coverage(
    idValue: unknown,
    runValue: unknown,
    afterId = '',
    sort?: TableSort,
  ): CoveragePage {
    const id = orgId(idValue);
    const run = text(runValue, 'Run ID', 180);
    if (sort !== undefined) {
      const page = sortedPage<CoveragePage['classes'][number]>(
        this.db,
        `SELECT c.apexClass AS id, a.name, c.numLineCovered AS covered,
        c.numLineUncovered AS uncovered, c.percentage FROM GlobalCoverage c JOIN ApexClass a ON a.id = c.apexClass AND a.orgId = c.orgId
        WHERE c.orgId = ? AND c.run = ?`,
        [id, run],
        afterId,
        sort,
        {
          columns: { name: 'name COLLATE NOCASE', percentage: 'percentage' },
          id: 'id',
          scope: JSON.stringify([id, run]),
        },
      );
      return { classes: page.rows, nextCursor: page.nextCursor };
    }
    if (typeof afterId !== 'string' || afterId.length > 18)
      throw new ImportValidationError('Invalid coverage cursor.');
    const classes = this.db
      .prepare(`SELECT c.apexClass AS id, a.name, c.numLineCovered AS covered,
      c.numLineUncovered AS uncovered, c.percentage FROM GlobalCoverage c
      JOIN ApexClass a ON a.id = c.apexClass AND a.orgId = c.orgId
      WHERE c.orgId = ? AND c.run = ? AND c.apexClass > ? ORDER BY c.apexClass LIMIT 51`)
      .all(id, run, afterId) as unknown as CoveragePage['classes'];
    const more = classes.length > 50;
    if (more) classes.pop();
    return { classes, nextCursor: more ? classes.at(-1)!.id : null };
  }

  private clearSession(session: string): void {
    const previous = this.prepared.get(session);
    if (previous) clearTimeout(previous.timer);
    this.prepared.delete(session);
  }

  private availableBytes(): number {
    return (
      MAX_IMPORT_BYTES -
      [...this.prepared.values()].reduce((sum, item) => sum + item.bytes, 0)
    );
  }

  prepareFile(
    filename: string,
    session = 'default',
    targetOrgId?: string,
  ): DeploymentPreview {
    this.clearSession(session);
    const descriptor = openSync(filename, 'r');
    let json: string;
    try {
      const info = fstatSync(descriptor);
      if (
        !info.isFile() ||
        info.size === 0 ||
        info.size > this.availableBytes()
      )
        throw new ImportValidationError(
          'Choose a nonempty JSON file. Previews across all windows are limited to 64 MiB; close another preview if needed.',
        );
      const buffer = Buffer.alloc(info.size + 1);
      let length = 0;
      while (length < buffer.length) {
        const read = readSync(
          descriptor,
          buffer,
          length,
          buffer.length - length,
          null,
        );
        if (read === 0) break;
        length += read;
      }
      if (length > info.size)
        throw new ImportValidationError(
          'The file changed while being read. Choose it again.',
        );
      json = buffer
        .subarray(0, length)
        .toString('utf8')
        .replace(/^\uFEFF/, '');
    } finally {
      closeSync(descriptor);
    }
    return this.prepareJson(
      json,
      path.basename(filename),
      session,
      targetOrgId,
    );
  }

  /** Also used by source-level tests; never exposed through renderer IPC. */
  prepareJson(
    json: string,
    sourceName: string,
    session = 'default',
    targetOrgId?: string,
  ): DeploymentPreview {
    this.clearSession(session);
    if (
      this.prepared.size >= 8 ||
      Buffer.byteLength(json) > this.availableBytes()
    )
      throw new ImportValidationError('The import exceeds 64 MiB.');
    const data = parseDeployment(json);
    if (targetOrgId) {
      const target = this.get(targetOrgId);
      if (data.orgId && data.orgId !== target.id)
        throw new ImportValidationError(
          'The JSON belongs to a different organization. Open that organization to import it.',
        );
    }
    const token = randomUUID();
    const timer = setTimeout(
      () => this.clearSession(session),
      PREVIEW_LIFETIME,
    );
    timer.unref();
    this.prepared.set(session, {
      token,
      sourceName,
      data,
      json,
      expires: Date.now() + PREVIEW_LIFETIME,
      targetOrgId,
      timer,
      bytes: Buffer.byteLength(json),
    });
    return {
      token,
      sourceName,
      runId: data.runId,
      orgId: data.orgId,
      hostName: data.hostName,
      startTime: data.startTime,
      status: data.status,
      classCount: data.classes.length,
      testClassCount: data.testClasses.length,
      testsRun: data.testsRun,
      failures: data.failures,
    };
  }

  commit(
    tokenValue: unknown,
    idValue: unknown,
    hostnameValue: unknown,
    session = 'default',
  ): ImportReceipt {
    const token = importToken(tokenValue);
    const staged = this.prepared.get(session);
    if (!staged || staged.token !== token || staged.expires <= Date.now())
      throw new ImportValidationError(
        'The import preview expired. Choose the file again.',
      );
    const id = orgId(idValue);
    const hostname = hostName(hostnameValue);
    if (staged.targetOrgId && this.get(staged.targetOrgId).id !== id)
      throw new ImportValidationError(
        'This import belongs to another organization window.',
      );
    if (staged.data.orgId !== null && orgId(staged.data.orgId) !== id)
      throw new ImportValidationError(
        'The selected org ID does not match the org ID in the JSON.',
      );
    const { data } = staged;
    this.db.exec('BEGIN IMMEDIATE');
    try {
      this.db
        .prepare(
          'INSERT INTO Org(id, hostName) VALUES (?, ?) ON CONFLICT(id) DO UPDATE SET hostName = excluded.hostName',
        )
        .run(id, hostname);
      this.db
        .prepare(
          'INSERT INTO Run(id, orgId, startTime) VALUES (?, ?, ?) ON CONFLICT(id, orgId) DO UPDATE SET startTime = COALESCE(excluded.startTime, Run.startTime)',
        )
        .run(data.runId, id, data.startTime);
      const writeClass = this.db.prepare(
        'INSERT INTO ApexClass(id, orgId, name) VALUES (?, ?, ?) ON CONFLICT(id, orgId) DO UPDATE SET name = excluded.name',
      );
      const writeTest = this.db.prepare(
        'INSERT INTO ApexTestClass(id, orgId, name) VALUES (?, ?, ?) ON CONFLICT(id, orgId) DO UPDATE SET name = excluded.name',
      );
      const writeCoverage = this.db
        .prepare(`INSERT INTO GlobalCoverage(apexClass, run, orgId, numLineCovered, numLineUncovered) VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(apexClass, run, orgId) DO UPDATE SET numLineCovered = excluded.numLineCovered, numLineUncovered = excluded.numLineUncovered`);
      for (const row of data.classes) {
        writeClass.run(row.id, id, row.name);
        writeCoverage.run(row.id, data.runId, id, row.covered, row.uncovered);
      }
      for (const row of data.testClasses) writeTest.run(row.id, id, row.name);
      persistDetailedCoverage(this.db, id, data);
      persistTestResults(this.db, id, data.runId, data);
      this.db
        .prepare(`UPDATE Run SET percentage = (
        SELECT round(100.0 * sum(numLineCovered) / NULLIF(sum(numLineCovered + numLineUncovered), 0), 2)
        FROM GlobalCoverage WHERE orgId = ? AND run = ?
      ) WHERE id = ? AND orgId = ?`)
        .run(id, data.runId, data.runId, id);
      this.db
        .prepare(`INSERT INTO DeploymentImport(run, orgId, sourceName, importedAt, document) VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(run, orgId) DO UPDATE SET sourceName = excluded.sourceName, importedAt = excluded.importedAt, document = excluded.document`)
        .run(
          data.runId,
          id,
          staged.sourceName,
          new Date().toISOString(),
          staged.json,
        );
      this.db.exec('COMMIT');
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
    this.clearSession(session);
    return {
      orgId: id,
      runId: data.runId,
      classCount: data.classes.length,
      testClassCount: data.testClasses.length,
    };
  }

  discard(token: unknown, session = 'default'): void {
    if (this.prepared.get(session)?.token === importToken(token))
      this.clearSession(session);
  }

  releaseSession(session: string): void {
    this.clearSession(session);
  }

  dispose(): void {
    for (const session of this.prepared.keys()) this.clearSession(session);
  }
}
