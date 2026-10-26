import type { DatabaseSync } from 'node:sqlite';

/** Child-first deletion keeps all existing foreign keys restrictive. One atomic transaction. */
export function deleteOrganization(db: DatabaseSync, id: string): boolean {
  db.exec('BEGIN IMMEDIATE');
  try {
    for (const table of [
      'RunTestResult',
      'RunReport',
      'TestMethodCoverage',
      'TestClassCoverage',
      'GlobalCoverage',
      'DeploymentImport',
      'ApexTestClass',
      'ApexClass',
      'Run',
    ]) {
      db.prepare(`DELETE FROM ${table} WHERE orgId = ?`).run(id);
    }
    const removed =
      db.prepare('DELETE FROM Org WHERE id = ?').run(id).changes !== 0;
    db.exec('COMMIT');
    return removed;
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}
