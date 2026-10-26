import type { DatabaseSync } from 'node:sqlite';
import { parseDeployment } from '../../features/orgs/parse-deployment';
import { persistTestResults } from '../../features/orgs/persist-test-results';

export function runResultsV4(db: DatabaseSync): void {
  db.exec(`
    CREATE INDEX Run_org_date ON Run(orgId, COALESCE(startTime, ''), id);
    CREATE TABLE RunReport (
      run TEXT NOT NULL, orgId TEXT NOT NULL, status TEXT NOT NULL,
      testsRun INTEGER NOT NULL, failures INTEGER NOT NULL,
      PRIMARY KEY(run, orgId), FOREIGN KEY(run, orgId) REFERENCES Run(id, orgId)
    ) STRICT, WITHOUT ROWID;
    CREATE TABLE RunTestResult (
      run TEXT NOT NULL, orgId TEXT NOT NULL, testIndex INTEGER NOT NULL,
      classId TEXT NOT NULL, className TEXT NOT NULL, methodName TEXT NOT NULL,
      outcome TEXT NOT NULL, duration REAL, message TEXT,
      PRIMARY KEY(run, orgId, testIndex), FOREIGN KEY(run, orgId) REFERENCES Run(id, orgId)
    ) STRICT, WITHOUT ROWID;
  `);
  // Existing archives are normalized once in the worker, not on every page request.
  for (const row of db
    .prepare('SELECT run, orgId, document FROM DeploymentImport')
    .iterate()) {
    persistTestResults(
      db,
      String(row.orgId),
      String(row.run),
      parseDeployment(String(row.document)),
    );
  }
}
