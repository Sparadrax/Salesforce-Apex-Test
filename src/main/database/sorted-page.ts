import { Buffer } from 'node:buffer';
import type { DatabaseSync, SQLInputValue } from 'node:sqlite';
import type { TableSort } from '../../shared/contracts/table-sort';
import { ImportValidationError } from '../features/orgs/import-validation';

interface SortConfig {
  columns: Record<string, string>;
  id: string;
  scope: string;
}
/** Only allowlisted expressions enter SQL; values and cursor boundaries are bound parameters. */
export function sortedPage<T extends object>(
  db: DatabaseSync,
  sql: string,
  args: SQLInputValue[],
  after: unknown,
  input: unknown,
  config: SortConfig,
): { rows: T[]; nextCursor: string | null } {
  if (
    !input ||
    typeof input !== 'object' ||
    !('column' in input) ||
    !('direction' in input) ||
    typeof input.column !== 'string' ||
    !Object.hasOwn(config.columns, input.column) ||
    (input.direction !== 'asc' && input.direction !== 'desc')
  )
    throw new ImportValidationError('Invalid table sort.');
  const sort = input as TableSort;
  const expression = config.columns[sort.column]!;
  let boundary = '';
  const values: SQLInputValue[] = [...args];
  if (after !== '' && after !== undefined) {
    let cursor: {
      column: string;
      direction: string;
      scope: string;
      value: string | number | null;
      id: string;
    };
    try {
      if (
        typeof after !== 'string' ||
        after.length > 4096 ||
        !after.startsWith('sort:')
      )
        throw new Error();
      cursor = JSON.parse(
        Buffer.from(after.slice(5), 'base64url').toString('utf8'),
      );
      if (
        !cursor ||
        cursor.column !== sort.column ||
        cursor.direction !== sort.direction ||
        cursor.scope !== config.scope ||
        typeof cursor.id !== 'string' ||
        cursor.id.length > 180 ||
        !(
          cursor.value === null ||
          (typeof cursor.value === 'string' && cursor.value.length <= 180) ||
          (typeof cursor.value === 'number' && Number.isFinite(cursor.value))
        )
      )
        throw new Error();
    } catch {
      throw new ImportValidationError(
        'The table sort changed. Reload the table.',
      );
    }
    if (cursor.value === null) {
      boundary = `WHERE ${expression} IS NULL AND ${config.id} > ?`;
      values.push(cursor.id);
    } else {
      boundary = `WHERE (${expression} ${sort.direction === 'asc' ? '>' : '<'} ? OR ${expression} IS NULL OR (${expression} = ? AND ${config.id} > ?))`;
      values.push(cursor.value, cursor.value, cursor.id);
    }
  }
  const rows = db
    .prepare(
      `SELECT * FROM (${sql}) AS sorted ${boundary} ORDER BY ${expression} ${sort.direction === 'asc' ? 'ASC' : 'DESC'} NULLS LAST, ${config.id} ASC LIMIT 51`,
    )
    .all(...values);
  const more = rows.length > 50;
  if (more) rows.pop();
  const last = rows.at(-1);
  return {
    rows: rows as unknown as T[],
    nextCursor:
      more && last
        ? `sort:${Buffer.from(JSON.stringify({ ...sort, scope: config.scope, value: last[sort.column], id: last[config.id] })).toString('base64url')}`
        : null,
  };
}

export function tableCursor(value: unknown): string {
  if (value === undefined || value === '') return '';
  if (typeof value !== 'string' || value.length > 4096)
    throw new ImportValidationError('Invalid table cursor.');
  return value;
}
