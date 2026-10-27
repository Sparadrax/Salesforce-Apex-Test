import type {
  OrgRunsApi,
  CoverageRow,
  CoveringTestClass,
  CoveredMethod,
} from '../../../shared/contracts/orgs';
import { element, cell } from '../../shared/dom';
import { ScrollTable } from '../../shared/scroll-table';
import { coverageTrend } from './coverage-trend';

const percentage = (value: number | null) =>
  value === null ? '—' : `${value.toFixed(2)}%`;
export function mountCoverageExplorer(
  root: Document,
  api: OrgRunsApi,
  onError: (cause: unknown) => void,
) {
  let runId = '';
  let apexClass: string | null = null;
  let testClass: string | null = null;
  const abort = new AbortController();
  const options = { signal: abort.signal };
  function mark(prefix: string, id: string | null): void {
    for (const row of element(
      root,
      `${prefix}-body`,
    ).querySelectorAll<HTMLTableRowElement>('tr')) {
      const selected = row.dataset.id === id;
      row.classList.toggle('selected', selected);
      row
        .querySelector('button')
        ?.setAttribute('aria-pressed', String(selected));
    }
  }
  function nameRow(
    id: string,
    name: string,
    score: number | null,
  ): HTMLTableRowElement {
    const row = root.createElement('tr');
    row.dataset.id = id;
    const nameCell = root.createElement('td');
    const button = root.createElement('button');
    button.type = 'button';
    button.className = 'drilldown-name';
    button.textContent = name;
    button.setAttribute('aria-pressed', 'false');
    nameCell.append(button);
    const scoreCell = cell(root, percentage(score));
    if (score === null) scoreCell.title = 'Coverage was not supplied.';
    row.append(nameCell, scoreCell);
    return row;
  }
  function clearMethods(): void {
    testClass = null;
    mark('test-classes', null);
    element(root, 'methods-context').textContent = 'Select a test class';
    methods.reset('Select a test class to see its methods and outcomes.');
  }
  function clearTests(): void {
    apexClass = null;
    mark('classes', null);
    element(root, 'test-classes-context').textContent = 'Select an Apex class';
    tests.reset('Select an Apex class to see the test classes that cover it.');
    clearMethods();
  }
  const methods = new ScrollTable<CoveredMethod>({
    sorting: {
      columns: ['name', 'outcome', 'percentage'],
      initial: { column: 'name', direction: 'asc' },
    },
    panel: element(root, 'methods-panel'),
    body: element(root, 'methods-body'),
    empty: element(root, 'methods-empty'),
    fetch: async (after, sort) => {
      const page = await api.methods(
        runId,
        apexClass!,
        testClass!,
        after,
        sort,
      );
      return { rows: page.methods, nextCursor: page.nextCursor };
    },
    render: (method) => {
      const row = root.createElement('tr');
      const name = cell(root, method.name);
      if (method.message) {
        const detail = root.createElement('small');
        detail.className = 'test-message';
        detail.textContent = method.message;
        name.append(detail);
      }
      const outcome = cell(
        root,
        method.failed === true
          ? 'Failed'
          : method.failed === false
            ? 'Passed'
            : (method.outcome ?? 'Unknown'),
      );
      outcome.className =
        method.failed === true
          ? 'failed'
          : method.failed === false
            ? 'passed'
            : '';
      row.append(name, outcome, cell(root, percentage(method.percentage)));
      return row;
    },
    error: onError,
  });
  const tests = new ScrollTable<CoveringTestClass>({
    sorting: {
      columns: ['name', 'percentage'],
      initial: { column: 'name', direction: 'asc' },
    },
    panel: element(root, 'test-classes-panel'),
    body: element(root, 'test-classes-body'),
    empty: element(root, 'test-classes-empty'),
    fetch: async (after, sort) => {
      const page = await api.coveringTests(runId, apexClass!, after, sort);
      return { rows: page.classes, nextCursor: page.nextCursor };
    },
    render: (item) => {
      const row = nameRow(item.id, item.name ?? item.id, item.percentage);
      if (item.id === testClass) {
        row.classList.add('selected');
        row.querySelector('button')?.setAttribute('aria-pressed', 'true');
      }
      return row;
    },
    error: onError,
  });
  const classes = new ScrollTable<CoverageRow>({
    sorting: {
      columns: ['name', 'percentage'],
      initial: { column: 'name', direction: 'asc' },
    },
    panel: element(root, 'classes-panel'),
    body: element(root, 'classes-body'),
    empty: element(root, 'classes-empty'),
    fetch: async (after, sort) => {
      const page = await api.coverage(runId, after, sort);
      return { rows: page.classes, nextCursor: page.nextCursor };
    },
    render: (item) => {
      const row = nameRow(item.id, item.name ?? item.id, item.percentage);
      if (item.id === apexClass) {
        row.classList.add('selected');
        row.querySelector('button')?.setAttribute('aria-pressed', 'true');
      }
      if (item.percentage !== null && item.percentage <= 80) {
        row.classList.add(
          item.percentage < 75 ? 'coverage-red' : 'coverage-yellow',
        );
        row.lastElementChild?.setAttribute(
          'aria-label',
          `${percentage(item.percentage)} coverage — ${item.percentage < 75 ? 'below 75%' : '75% to 80%'}`,
        );
      }
      const trend = coverageTrend(
        root,
        item.percentage,
        item.previousPercentage ?? null,
      );
      const scoreCell = row.lastElementChild!;
      scoreCell.append(trend);
      scoreCell.setAttribute(
        'aria-label',
        `${scoreCell.getAttribute('aria-label') ?? percentage(item.percentage)}. ${trend.title}`,
      );
      return row;
    },
    error: onError,
  });
  element(root, 'classes-body').addEventListener(
    'contextmenu',
    (event) => {
      const row = (
        event.target as HTMLElement | null
      )?.closest<HTMLTableRowElement>('tr[data-id]');
      if (!row?.dataset.id) return;
      event.preventDefault();
      void api.openHistory(row.dataset.id).catch(onError);
    },
    options,
  );
  element(root, 'classes-body').addEventListener(
    'click',
    (event) => {
      const row = (
        event.target as HTMLElement | null
      )?.closest<HTMLTableRowElement>('tr[data-id]');
      if (!row?.dataset.id) return;
      const name = row.querySelector('button')?.textContent ?? row.dataset.id;
      clearMethods();
      apexClass = row.dataset.id;
      mark('classes', apexClass);
      element(root, 'test-classes-context').textContent = name;
      tests.reset('Loading…');
      void tests.load(
        'No test-class coverage links were supplied for this Apex class.',
      );
    },
    options,
  );
  element(root, 'test-classes-body').addEventListener(
    'click',
    (event) => {
      const row = (
        event.target as HTMLElement | null
      )?.closest<HTMLTableRowElement>('tr[data-id]');
      if (!row?.dataset.id || !apexClass) return;
      clearMethods();
      testClass = row.dataset.id;
      mark('test-classes', testClass);
      element(root, 'methods-context').textContent =
        row.querySelector('button')?.textContent ?? testClass;
      void methods.load('No methods were included for this test class.');
    },
    options,
  );
  clearTests();
  classes.reset('Choose a run to see Apex classes.');
  return {
    async setRun(id: string): Promise<void> {
      runId = id;
      clearTests();
      classes.reset('Loading…');
      await classes.load('No Apex class coverage was supplied for this run.');
    },
    clear(): void {
      runId = '';
      clearTests();
      classes.reset('Choose a run to see Apex classes.');
    },
    dispose(): void {
      abort.abort();
      classes.dispose();
      tests.dispose();
      methods.dispose();
    },
  };
}
