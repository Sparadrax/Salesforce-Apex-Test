import type { TableSort } from '../../shared/contracts/table-sort';

/** Shared accessible header behavior for server-backed and fully loaded local tables. */
export class TableHeaders {
  private current: TableSort;
  private readonly abort = new AbortController();
  private readonly headers: {
    th: HTMLTableCellElement;
    key: string;
    label: string;
    button: HTMLButtonElement;
  }[] = [];
  constructor(
    table: HTMLTableElement,
    columns: (string | null)[],
    initial: TableSort,
    onChange: (sort: TableSort) => void,
  ) {
    this.current = { ...initial };
    for (const [index, th] of [
      ...table.querySelectorAll<HTMLTableCellElement>('thead th'),
    ].entries()) {
      const key = columns[index];
      if (!key) continue;
      const label = th.textContent?.trim() ?? key;
      const button = table.ownerDocument.createElement('button');
      button.type = 'button';
      button.className = 'table-sort';
      button.setAttribute('aria-label', `Sort by ${label}`);
      th.replaceChildren(button);
      this.headers.push({ th, key, label, button });
      button.addEventListener(
        'click',
        () => {
          this.current = {
            column: key,
            direction:
              this.current.column === key && this.current.direction === 'asc'
                ? 'desc'
                : 'asc',
          };
          this.update();
          onChange(this.value);
        },
        { signal: this.abort.signal },
      );
    }
    this.update();
  }
  get value(): TableSort {
    return { ...this.current };
  }
  private update(): void {
    for (const { th, key, label, button } of this.headers) {
      const active = this.current.column === key;
      th.setAttribute(
        'aria-sort',
        active
          ? this.current.direction === 'asc'
            ? 'ascending'
            : 'descending'
          : 'none',
      );
      button.textContent = `${label} ${active ? (this.current.direction === 'asc' ? '▲' : '▼') : '↕'}`;
    }
  }
  dispose(): void {
    this.abort.abort();
  }
}

const collator = new Intl.Collator(undefined, {
  numeric: true,
  sensitivity: 'base',
});
export function compareCells(
  a: string | number | null,
  b: string | number | null,
  direction: 'asc' | 'desc',
): number {
  if (a === null) return b === null ? 0 : 1;
  if (b === null) return -1;
  const result =
    typeof a === 'number' && typeof b === 'number'
      ? a - b
      : collator.compare(String(a), String(b));
  return direction === 'asc' ? result : -result;
}
