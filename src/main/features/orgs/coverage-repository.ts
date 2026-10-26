import type { DatabaseSync } from 'node:sqlite';
import type {
  CoveredMethodPage,
  CoveringTestClassPage,
} from '../../../shared/contracts/orgs';
import { ImportValidationError, orgId, text } from './import-validation';
import type { TableSort } from '../../../shared/contracts/table-sort';
import { sortedPage } from '../../database/sorted-page';

function cursor(value: unknown, max: number): string {
  if (value === undefined || value === '') return '';
  if (typeof value !== 'string' || value.length > max)
    throw new ImportValidationError('Invalid coverage cursor.');
  return value;
}

/** Indexed relational drill-down; never infers attribution from aggregate coverage. */
export class CoverageRepository {
  constructor(private readonly db: DatabaseSync) {}

  coveringTests(
    orgValue: unknown,
    runValue: unknown,
    classValue: unknown,
    afterId: unknown = '',
    sort?: TableSort,
  ): CoveringTestClassPage {
    const org = orgId(orgValue);
    const run = text(runValue, 'Run ID', 180);
    const apexClass = text(classValue, 'Apex class', 18);
    if (sort !== undefined) {
      const page = sortedPage<CoveringTestClassPage['classes'][number]>(
        this.db,
        `WITH linked AS (
        SELECT apexTestClass AS id FROM TestClassCoverage WHERE orgId = ? AND run = ? AND apexClass = ?
        UNION SELECT apexTestClass AS id FROM TestMethodCoverage WHERE orgId = ? AND run = ? AND apexClass = ?)
        SELECT l.id, a.name, c.percentage FROM linked l JOIN ApexTestClass a ON a.id = l.id AND a.orgId = ?
        LEFT JOIN TestClassCoverage c ON c.apexTestClass = l.id AND c.apexClass = ? AND c.run = ? AND c.orgId = ?`,
        [org, run, apexClass, org, run, apexClass, org, apexClass, run, org],
        afterId,
        sort,
        {
          columns: { name: 'name COLLATE NOCASE', percentage: 'percentage' },
          id: 'id',
          scope: JSON.stringify([org, run, apexClass]),
        },
      );
      return { classes: page.rows, nextCursor: page.nextCursor };
    }
    const after = cursor(afterId, 18);
    const classes = this.db
      .prepare(`
      WITH linked AS (
        SELECT apexTestClass AS id FROM TestClassCoverage
        WHERE orgId = ? AND run = ? AND apexClass = ? AND apexTestClass > ?
        UNION
        SELECT apexTestClass AS id FROM TestMethodCoverage
        WHERE orgId = ? AND run = ? AND apexClass = ? AND apexTestClass > ?
        ORDER BY 1 LIMIT 51
      )
      SELECT l.id, a.name, c.percentage FROM linked l
      JOIN ApexTestClass a ON a.id = l.id AND a.orgId = ?
      LEFT JOIN TestClassCoverage c ON c.apexTestClass = l.id AND c.apexClass = ? AND c.run = ? AND c.orgId = ?
      ORDER BY l.id
    `)
      .all(
        org,
        run,
        apexClass,
        after,
        org,
        run,
        apexClass,
        after,
        org,
        apexClass,
        run,
        org,
      ) as unknown as CoveringTestClassPage['classes'];
    const more = classes.length > 50;
    if (more) classes.pop();
    return { classes, nextCursor: more ? classes.at(-1)!.id : null };
  }

  methods(
    orgValue: unknown,
    runValue: unknown,
    classValue: unknown,
    testValue: unknown,
    afterName: unknown = '',
    sort?: TableSort,
  ): CoveredMethodPage {
    const org = orgId(orgValue);
    const run = text(runValue, 'Run ID', 180);
    const apexClass = text(classValue, 'Apex class', 18);
    const testClass = text(testValue, 'Test class', 18);
    const after = sort === undefined ? cursor(afterName, 180) : '';
    const linked = this.db
      .prepare(`SELECT 1 FROM TestClassCoverage WHERE orgId = ? AND run = ? AND apexClass = ? AND apexTestClass = ?
      UNION ALL SELECT 1 FROM TestMethodCoverage WHERE orgId = ? AND run = ? AND apexClass = ? AND apexTestClass = ? LIMIT 1`)
      .get(org, run, apexClass, testClass, org, run, apexClass, testClass);
    if (!linked) return { methods: [], nextCursor: null };
    const baseSql = `
      WITH names AS (
        SELECT methodName AS name FROM RunTestResult WHERE orgId = ? AND run = ? AND classId = ? ${sort === undefined ? 'AND methodName > ?' : ''}
        UNION
        SELECT name FROM TestMethodCoverage WHERE orgId = ? AND run = ? AND apexClass = ? AND apexTestClass = ? ${sort === undefined ? 'AND name > ?' : ''}
        ${sort === undefined ? 'ORDER BY 1 LIMIT 51' : ''}
      )
      , selected AS (SELECT n.name, c.percentage,
        (SELECT testIndex FROM RunTestResult r WHERE r.orgId = ? AND r.run = ? AND r.classId = ? AND r.methodName = n.name
          ORDER BY CASE WHEN lower(r.outcome) IN ('fail', 'failed', 'compilefail') THEN 0 ELSE 1 END, r.testIndex DESC LIMIT 1) AS resultIndex
      FROM names n LEFT JOIN TestMethodCoverage c
        ON c.name = n.name AND c.orgId = ? AND c.run = ? AND c.apexClass = ? AND c.apexTestClass = ?
      )
      SELECT s.name, s.percentage, r.outcome, r.message FROM selected s
      LEFT JOIN RunTestResult r ON r.orgId = ? AND r.run = ? AND r.testIndex = s.resultIndex
      ${sort === undefined ? 'ORDER BY s.name' : ''}`;
    const args = [
      org,
      run,
      testClass,
      ...(sort === undefined ? [after] : []),
      org,
      run,
      apexClass,
      testClass,
      ...(sort === undefined ? [after] : []),
      org,
      run,
      testClass,
      org,
      run,
      apexClass,
      testClass,
      org,
      run,
    ];
    const page =
      sort === undefined
        ? null
        : sortedPage<Record<string, string | number | null>>(
            this.db,
            baseSql,
            args,
            afterName,
            sort,
            {
              columns: {
                name: 'name COLLATE NOCASE',
                outcome: 'outcome COLLATE NOCASE',
                percentage: 'percentage',
              },
              id: 'name',
              scope: JSON.stringify([org, run, apexClass, testClass]),
            },
          );
    const results = page ? page.rows : this.db.prepare(baseSql).all(...args);
    const more = results.length > 50;
    if (more) results.pop();
    const methods = results.map((row) => {
      const status = row.outcome === null ? null : String(row.outcome);
      return {
        name: String(row.name),
        percentage: row.percentage === null ? null : Number(row.percentage),
        outcome: status,
        failed:
          status === null
            ? null
            : /^(fail|failed|compilefail)$/i.test(status)
              ? true
              : /^(pass|passed)$/i.test(status)
                ? false
                : null,
        message: row.message === null ? null : String(row.message),
      };
    });
    return {
      methods,
      nextCursor: page ? page.nextCursor : more ? methods.at(-1)!.name : null,
    };
  }
}
