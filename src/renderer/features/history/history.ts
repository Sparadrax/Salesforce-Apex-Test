import type {
  ClassHistoryIdentity,
  CoverageHistoryApi,
  HistoryPoint,
} from '../../../shared/contracts/coverage-history';
import { element, message, cell, dateText } from '../../shared/dom';
import { localDay, selectedRange } from './date-range';
import { drawHistory } from './chart';
import { TableHeaders, compareCells } from '../../shared/table-sort';

export function mountHistory(
  root: Document,
  api: CoverageHistoryApi,
): () => void {
  const node = <T extends HTMLElement>(id: string) => element<T>(root, id);
  node('org-screen').hidden = true;
  node('run-screen').hidden = true;
  node('history-screen').hidden = false;
  const from = node<HTMLInputElement>('history-from');
  const through = node<HTMLInputElement>('history-through');
  const form = node<HTMLFormElement>('history-form');
  const apply = node<HTMLButtonElement>('history-apply');
  const abort = new AbortController();
  const options = { signal: abort.signal };
  let identity: ClassHistoryIdentity | null = null;
  let disposed = false;
  let sequence = 0;
  let allTime = true;
  let identitySequence = 0;
  let plotted: HistoryPoint[] = [];
  function renderData(): void {
    const sort = headers.value;
    const value = (point: HistoryPoint) =>
      sort.column === 'at'
        ? Date.parse(point.at)
        : sort.column === 'percentage'
          ? point.percentage
          : (point.runId ?? point.count);
    const rows = root.createDocumentFragment();
    for (const point of [...plotted].sort((a, b) =>
      compareCells(value(a), value(b), sort.direction),
    )) {
      const row = root.createElement('tr');
      row.append(
        cell(root, dateText(point.at)),
        cell(
          root,
          point.percentage === null ? '—' : `${point.percentage.toFixed(2)}%`,
        ),
        cell(root, point.runId ?? `${point.count} runs (average)`),
      );
      rows.append(row);
    }
    node('history-data').replaceChildren(rows);
  }
  const headers = new TableHeaders(
    node('history-data').closest<HTMLTableElement>('table')!,
    ['at', 'percentage', 'runId'],
    { column: 'at', direction: 'asc' },
    renderData,
  );
  function error(cause: unknown): void {
    node('history-error').textContent = message(cause);
    node('history-error').hidden = false;
  }
  async function load(): Promise<void> {
    if (!identity || disposed) return;
    const version = ++sequence;
    const startDay = from.value;
    const endDay = through.value;
    let range;
    try {
      range = selectedRange(startDay, endDay);
    } catch (cause) {
      apply.disabled = false;
      node('history-loading').hidden = true;
      node('history-chart').setAttribute('aria-busy', 'false');
      error(cause);
      return;
    }
    node('history-error').hidden = true;
    node('history-chart').setAttribute('aria-busy', 'true');
    apply.disabled = true;
    node('history-loading').hidden = false;
    try {
      const data = await api.query(range);
      if (disposed || version !== sequence) return;
      drawHistory(root, node('history-chart'), data);
      node('history-count').textContent =
        `${data.totalRuns.toLocaleString()} runs${data.aggregated ? ` · ${data.points.length} averaged points with min/max ranges` : ''}`;
      node('history-range-label').textContent = `${startDay} — ${endDay}`;
      plotted = data.points;
      renderData();
    } catch (cause) {
      if (!disposed && version === sequence) error(cause);
    } finally {
      if (!disposed && version === sequence) {
        apply.disabled = false;
        node('history-loading').hidden = true;
        node('history-chart').setAttribute('aria-busy', 'false');
      }
    }
  }
  function preset(days: number | null): void {
    allTime = days === null;
    const end = new Date();
    const start = new Date(end);
    if (days === null) {
      from.value = localDay(identity?.firstDate ?? end);
      through.value = localDay(identity?.lastDate ?? end);
    } else {
      start.setDate(start.getDate() - days + 1);
      from.value = localDay(start);
      through.value = localDay(end);
    }
    void load();
  }
  form.addEventListener(
    'submit',
    (event) => {
      event.preventDefault();
      if (form.reportValidity()) {
        allTime = false;
        void load();
      }
    },
    options,
  );
  node('history-presets').addEventListener(
    'click',
    (event) => {
      const button = (
        event.target as HTMLElement | null
      )?.closest<HTMLButtonElement>('button[data-days]');
      if (button)
        preset(
          button.dataset.days === 'all' ? null : Number(button.dataset.days),
        );
    },
    options,
  );
  async function refreshIdentity(): Promise<void> {
    const version = ++identitySequence;
    try {
      const current = await api.current();
      if (disposed || version !== identitySequence) return;
      identity = current;
      root.title = `${current.className ?? current.classId} · Coverage history`;
      node('history-class').textContent = current.className ?? current.classId;
      node('history-org').textContent =
        `${current.hostName ?? current.orgId} · ${current.classId}`;
      node('history-undated').textContent = current.undatedRuns
        ? `${current.undatedRuns} undated runs are omitted from the graph.`
        : '';
      if (allTime) preset(null);
      else await load();
    } catch (cause) {
      if (!disposed && version === identitySequence) error(cause);
    }
  }
  node('history-refresh').addEventListener(
    'click',
    () => {
      void refreshIdentity();
    },
    options,
  );
  const unsubscribe = api.onChanged((orgId) => {
    if (orgId === identity?.orgId) void refreshIdentity();
  });
  void refreshIdentity();
  return () => {
    disposed = true;
    sequence++;
    abort.abort();
    unsubscribe();
    headers.dispose();
  };
}
