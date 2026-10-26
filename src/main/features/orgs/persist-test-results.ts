import type { DatabaseSync } from 'node:sqlite';
import type { DeploymentData } from './parse-deployment';

/** Caller owns the surrounding transaction. Replace outcomes for this exact run only. */
export function persistTestResults(
  db: DatabaseSync,
  orgId: string,
  runId: string,
  data: DeploymentData,
): void {
  db.prepare(`INSERT INTO RunReport(run, orgId, status, testsRun, failures) VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(run, orgId) DO UPDATE SET status = excluded.status, testsRun = excluded.testsRun, failures = excluded.failures`).run(
    runId,
    orgId,
    data.status,
    data.testsRun,
    data.failures,
  );
  db.prepare('DELETE FROM RunTestResult WHERE run = ? AND orgId = ?').run(
    runId,
    orgId,
  );
  const insert = db.prepare(
    `INSERT INTO RunTestResult(run, orgId, testIndex, classId, className, methodName, outcome, duration, message) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  for (const row of data.tests)
    insert.run(
      runId,
      orgId,
      row.index,
      row.classId,
      row.className,
      row.methodName,
      row.outcome,
      row.duration,
      row.message,
    );
}
