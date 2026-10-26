import type { HistoryRange } from '../../../shared/contracts/coverage-history';

export function localDay(value: string | Date): string {
  const date = typeof value === 'string' ? new Date(value) : value;
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}
export function selectedRange(from: string, through: string): HistoryRange {
  function parse(day: string): Date {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day))
      throw new Error('Choose valid start and end dates.');
    const date = new Date(`${day}T00:00:00`);
    if (!Number.isFinite(date.getTime()) || localDay(date) !== day)
      throw new Error('Choose valid start and end dates.');
    return date;
  }
  const start = parse(from);
  const end = parse(through);
  if (start > end)
    throw new Error('The end date must be on or after the start date.');
  end.setDate(end.getDate() + 1);
  return { from: start.toISOString(), toExclusive: end.toISOString() };
}
