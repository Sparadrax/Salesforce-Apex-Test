import type { DatabaseSync } from 'node:sqlite';
import type {
  ClassHistoryIdentity,
  CoverageHistory,
  HistoryPoint,
  HistoryRange,
} from '../../../shared/contracts/coverage-history';
import { ImportValidationError, orgId, text } from '../orgs/import-validation';

export function historyRange(value: unknown): HistoryRange {
  if (
    !value ||
    typeof value !== 'object' ||
    !('from' in value) ||
    !('toExclusive' in value)
  )
    throw new ImportValidationError('Choose a start and end date.');
  function date(value: unknown): string {
    if (
      typeof value !== 'string' ||
      value.length !== 24 ||
      !Number.isFinite(Date.parse(value)) ||
      new Date(value).toISOString() !== value
    )
      throw new ImportValidationError('Invalid history date range.');
    return value;
  }
  const from = date(value.from);
  const toExclusive = date(value.toExclusive);
  if (from >= toExclusive)
    throw new ImportValidationError(
      'The end date must be on or after the start date.',
    );
  return { from, toExclusive };
}

/** Query and aggregation happen in the worker; graph payloads never exceed 1,000 points. */
export class CoverageHistoryRepository {
  constructor(private readonly db: DatabaseSync) {}
  current(orgValue: unknown, classValue: unknown): ClassHistoryIdentity {
    const org = orgId(orgValue);
    const apexClass = text(classValue, 'Apex class', 18);
    const identity = this.db
      .prepare(`SELECT o.id AS orgId, o.hostName, a.id AS classId, a.name AS className
      FROM ApexClass a JOIN Org o ON o.id = a.orgId WHERE a.orgId = ? AND a.id = ?`)
      .get(org, apexClass);
    if (!identity)
      throw new ImportValidationError(
        'This class does not exist in this organization.',
      );
    const bounds = this.db
      .prepare(`SELECT min(r.startTime) AS firstDate, max(r.startTime) AS lastDate,
      COALESCE(sum(CASE WHEN r.startTime IS NULL THEN 1 ELSE 0 END), 0) AS undatedRuns
      FROM GlobalCoverage c JOIN Run r ON r.id = c.run AND r.orgId = c.orgId
      WHERE c.orgId = ? AND c.apexClass = ?`)
      .get(org, apexClass)!;
    return { ...identity, ...bounds } as unknown as ClassHistoryIdentity;
  }

  query(
    orgValue: unknown,
    classValue: unknown,
    input: unknown,
  ): CoverageHistory {
    const org = orgId(orgValue);
    const apexClass = text(classValue, 'Apex class', 18);
    const range = historyRange(input);
    const fromClause = `FROM Run r JOIN GlobalCoverage c ON c.run = r.id AND c.orgId = r.orgId
      WHERE r.orgId = ? AND c.apexClass = ? AND r.startTime >= ? AND r.startTime < ?`;
    const args = [org, apexClass, range.from, range.toExclusive];
    const stats = this.db
      .prepare(
        `SELECT count(*) AS total, min(r.startTime) AS first, max(r.startTime) AS last ${fromClause}`,
      )
      .get(...args)!;
    const totalRuns = Number(stats.total);
    if (totalRuns <= 1000) {
      const points = this.db
        .prepare(`SELECT r.startTime AS at, c.percentage, c.percentage AS minimum,
        c.percentage AS maximum, 1 AS count, r.id AS runId ${fromClause} ORDER BY r.startTime, r.id`)
        .all(...args) as unknown as HistoryPoint[];
      return { totalRuns, aggregated: false, points };
    }
    const start = String(stats.first);
    const bucketMs = Math.max(
      1,
      (Date.parse(String(stats.last)) - Date.parse(start)) / 500,
    );
    const points = this.db
      .prepare(`SELECT min(r.startTime) AS at, avg(c.percentage) AS percentage,
      min(c.percentage) AS minimum, max(c.percentage) AS maximum, count(*) AS count, NULL AS runId
      ${fromClause}
      GROUP BY min(499, CAST(((julianday(r.startTime) - julianday(?)) * 86400000.0) / ? AS INTEGER))
      ORDER BY at`)
      .all(...args, start, bucketMs) as unknown as HistoryPoint[];
    return { totalRuns, aggregated: true, points };
  }
}
