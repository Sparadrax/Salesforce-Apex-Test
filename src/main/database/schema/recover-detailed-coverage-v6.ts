import type { DatabaseSync } from 'node:sqlite';
import { parseDeployment } from '../../features/orgs/parse-deployment';
import { persistDetailedCoverage } from '../../features/orgs/persist-detailed-coverage';

/** Older builds archived the detail extension without normalizing its coverage links. */
export function recoverDetailedCoverageV6(db: DatabaseSync): void {
  const archives = db.prepare(`SELECT orgId, run, document FROM DeploymentImport
    WHERE json_type(document, '$.sfccCoverage') = 'object'
       OR json_type(document, '$.result.sfccCoverage') = 'object'`);
  for (const row of archives.iterate()) {
    const data = parseDeployment(String(row.document));
    // The archive's persisted identity remains authoritative, including fallback run IDs.
    persistDetailedCoverage(db, String(row.orgId), {
      ...data,
      runId: String(row.run),
    });
  }
}
