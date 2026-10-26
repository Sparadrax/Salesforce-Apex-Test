import type { TableSort } from '../../shared/contracts/table-sort';
import { TableHeaders } from './table-sort';

export interface ScrollPage<T> {
  rows: T[];
  nextCursor: string | null;
}
interface ScrollTableOptions<T> {
  panel: HTMLElement;
  body: HTMLElement;
  empty: HTMLElement;
  fetch: (cursor: string, sort?: TableSort) => Promise<ScrollPage<T>>;
  render: (row: T) => HTMLTableRowElement;
  error: (cause: unknown) => void;
  changed?: (count: number) => void;
  sorting?: { columns: (string | null)[]; initial: TableSort };
}

/** Fetch cursor batches as the user scrolls; never replace rows or reset selection on append. */
export class ScrollTable<T> {
  private readonly viewport: HTMLElement;
  private readonly sentinel: HTMLElement;
  private readonly observer: IntersectionObserver | undefined;
  private readonly abort = new AbortController();
  private cursor: string | null = null;
  private readonly requested = new Set<string>();
  private version = 0;
  private busy = false;
  private disposed = false;
  private started = false;
  private emptyText = 'No records.';
  private count = 0;
  private readonly headers: TableHeaders | undefined;
  constructor(private readonly options: ScrollTableOptions<T>) {
    const viewport = options.panel.querySelector<HTMLElement>('.table-scroll');
    if (!viewport) throw new Error('Missing table scroll container');
    this.viewport = viewport;
    const table = options.body.closest<HTMLTableElement>('table');
    this.headers =
      options.sorting && table
        ? new TableHeaders(
            table,
            options.sorting.columns,
            options.sorting.initial,
            () => {
              if (!this.started) return;
              const text = this.emptyText;
              this.reset(text);
              void this.load(text);
            },
          )
        : undefined;
    viewport.tabIndex = 0;
    this.sentinel = options.body.ownerDocument.createElement('div');
    this.sentinel.className = 'scroll-table-status';
    this.sentinel.setAttribute('role', 'status');
    viewport.append(this.sentinel);
    viewport.addEventListener('scroll', () => this.checkScroll(), {
      passive: true,
      signal: this.abort.signal,
    });
    const Observer =
      options.body.ownerDocument.defaultView?.IntersectionObserver;
    this.observer =
      typeof Observer === 'function'
        ? new Observer(
            (entries) => {
              if (entries.some((entry) => entry.isIntersecting))
                void this.loadMore();
            },
            { root: viewport, rootMargin: '150px' },
          )
        : undefined;
    this.observer?.observe(this.sentinel);
  }
  reset(text: string): void {
    this.version++;
    this.busy = false;
    this.started = false;
    this.cursor = null;
    this.count = 0;
    this.requested.clear();
    this.options.body.replaceChildren();
    this.viewport.scrollTop = 0;
    this.options.empty.textContent = text;
    this.options.empty.hidden = !text;
    this.sentinel.textContent = '';
    this.options.panel.setAttribute('aria-busy', 'false');
  }
  async load(emptyText = 'No records.'): Promise<void> {
    if (this.started || this.disposed) return;
    this.started = true;
    this.emptyText = emptyText;
    await this.fetchPage('');
  }
  async loadMore(): Promise<void> {
    if (!this.started || this.busy || this.cursor === null || this.disposed)
      return;
    await this.fetchPage(this.cursor);
  }
  private checkScroll(): void {
    if (
      this.viewport.clientHeight > 0 &&
      this.viewport.scrollHeight -
        this.viewport.scrollTop -
        this.viewport.clientHeight <
        150
    )
      void this.loadMore();
  }
  private async fetchPage(cursor: string): Promise<void> {
    const version = this.version;
    this.busy = true;
    this.options.panel.setAttribute('aria-busy', 'true');
    this.sentinel.textContent = 'Loading…';
    try {
      if (this.requested.has(cursor))
        throw new Error('Unable to continue loading: repeated cursor.');
      this.requested.add(cursor);
      const page = await this.options.fetch(cursor, this.headers?.value);
      if (this.disposed || version !== this.version) return;
      if (page.nextCursor !== null && this.requested.has(page.nextCursor))
        throw new Error('Unable to continue loading: repeated cursor.');
      const fragment = this.options.body.ownerDocument.createDocumentFragment();
      for (const item of page.rows) fragment.append(this.options.render(item));
      this.options.body.append(fragment);
      this.count += page.rows.length;
      this.cursor = page.nextCursor;
      this.options.empty.textContent = this.emptyText;
      this.options.empty.hidden = this.count > 0 || !this.emptyText;
      this.sentinel.textContent = this.cursor === null ? '' : 'Scroll for more';
      this.options.changed?.(this.count);
    } catch (cause) {
      if (!this.disposed && version === this.version) {
        this.cursor = null;
        this.sentinel.textContent =
          'Unable to load more. Refresh or reselect to retry.';
        this.options.error(cause);
      }
    } finally {
      if (!this.disposed && version === this.version) {
        this.busy = false;
        this.options.panel.setAttribute('aria-busy', 'false');
        this.checkScroll();
      }
    }
  }
  dispose(): void {
    this.disposed = true;
    this.version++;
    this.abort.abort();
    this.observer?.disconnect();
    this.headers?.dispose();
    this.sentinel.remove();
  }
}
