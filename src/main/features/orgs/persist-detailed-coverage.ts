import type { DatabaseSync } from 'node:sqlite';
import type { DeploymentData } from './parse-deployment';

/** Caller owns the import transaction; parents must already exist. */
export function persistDetailedCoverage(
  db: DatabaseSync,
  orgId: string,
  data: DeploymentData,
): void {
  if (data.testClassCoverage.length) {
    const insert =
      db.prepare(`INSERT INTO TestClassCoverage(apexClass, apexTestClass, run, orgId, numLineCovered, numLineUncovered) VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(apexClass, apexTestClass, run, orgId) DO UPDATE SET numLineCovered = excluded.numLineCovered, numLineUncovered = excluded.numLineUncovered`);
    for (const row of data.testClassCoverage)
      insert.run(
        row.apexClass,
        row.apexTestClass,
        data.runId,
        orgId,
        row.numLineCovered,
        row.numLineUncovered,
      );
  }
  if (data.testMethodCoverage.length) {
    const insert =
      db.prepare(`INSERT INTO TestMethodCoverage(name, apexClass, apexTestClass, run, orgId, numLineCovered, numLineUncovered) VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(name, apexClass, apexTestClass, run, orgId) DO UPDATE SET numLineCovered = excluded.numLineCovered, numLineUncovered = excluded.numLineUncovered`);
    for (const row of data.testMethodCoverage)
      insert.run(
        row.name,
        row.apexClass,
        row.apexTestClass,
        data.runId,
        orgId,
        row.numLineCovered,
        row.numLineUncovered,
      );
  }
}
