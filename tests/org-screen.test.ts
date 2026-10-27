import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { setImmediate } from 'node:timers/promises';
import { test } from 'node:test';
import { parseHTML } from 'linkedom';
import { mountOrgs } from '../src/renderer/features/orgs/orgs';
import { mountRuns } from '../src/renderer/features/runs/runs';
import type {
  OrgsApi,
  OrgRunsApi,
  OrgSummary,
  DeploymentPreview,
} from '../src/shared/contracts/orgs';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const org: OrgSummary = {
  id: '00D000000000001EAA',
  hostName: 'example.my.salesforce.com',
  runCount: 2,
  lastRunAt: '2026-10-26T10:00:00Z',
  percentage: 80,
};
const preview: DeploymentPreview = {
  token: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
  sourceName: 'deployment.json',
  runId: 'new',
  orgId: null,
  hostName: null,
  startTime: null,
  status: 'Succeeded',
  classCount: 1,
  testClassCount: 1,
  testsRun: 1,
  failures: 0,
};
function dom() {
  const { document, window } = parseHTML(html);
  for (const dialog of document.querySelectorAll('dialog'))
    Object.assign(dialog, {
      showModal() {
        dialog.setAttribute('open', '');
      },
      close() {
        dialog.removeAttribute('open');
      },
    });
  for (const form of document.querySelectorAll('form'))
    Object.assign(form, { reportValidity: () => true, reset: () => {} });
  // linkedom implements select.value as read-only; real browser selects have a setter.
  for (const select of document.querySelectorAll('select')) {
    let value = '';
    Object.defineProperty(select, 'value', {
      get: () => value,
      set: (next: string) => {
        value = next;
      },
    });
  }
  const node = (id: string) => document.getElementById(id)!;
  const click = (id: string) =>
    node(id).dispatchEvent(new window.Event('click', { bubbles: true }));
  const submit = (id: string) =>
    node(id).dispatchEvent(new window.Event('submit', { cancelable: true }));
  return { document, window, node, click, submit };
}
function home(overrides: Partial<OrgsApi> = {}) {
  const screen = dom();
  const api: OrgsApi = {
    chooseImport: async () => null,
    confirmImport: async () => ({
      orgId: org.id,
      runId: 'new',
      classCount: 1,
      testClassCount: 1,
    }),
    discardImport: async () => {},
    remove: async () => false,
    list: async () => ({ orgs: [], nextCursor: null }),
    add: async () => org,
    open: async () => {},
    onChanged: () => () => {},
    ...overrides,
  };
  const dispose = mountOrgs(screen.document as unknown as Document, api);
  return { ...screen, dispose };
}
function results(overrides: Partial<OrgRunsApi> = {}) {
  const screen = dom();
  const api: OrgRunsApi = {
    openHistory: async () => {},
    current: async () => org,
    list: async () => ({
      runs: [
        {
          id: 'new',
          startTime: '2026-10-26T10:00:00Z',
          percentage: 80,
          status: 'Succeeded',
          testsRun: 1,
          failures: 0,
        },
        {
          id: 'old',
          startTime: '2026-10-25T10:00:00Z',
          percentage: 50,
          status: 'Failed',
          testsRun: 1,
          failures: 1,
        },
      ],
      nextCursor: null,
    }),
    tests: async (id) => ({
      tests: [
        {
          index: 0,
          classId: 'class-1',
          className: 'ExampleTest',
          methodName: `method-${id}`,
          outcome: id === 'new' ? 'Pass' : 'Fail',
          duration: 42,
          message: id === 'old' ? '<script>failed</script>' : null,
        },
      ],
      nextCursor: null,
    }),
    coveringTests: async () => ({
      classes: [{ id: 'test-1', name: 'ExampleTest', percentage: 60 }],
      nextCursor: null,
    }),
    methods: async (id) => ({
      methods: [
        {
          name: 'method-' + id,
          outcome: id === 'new' ? 'Pass' : 'Fail',
          failed: id !== 'new',
          percentage: 30,
          message: id === 'old' ? '<script>failed</script>' : null,
        },
      ],
      nextCursor: null,
    }),
    coverage: async () => ({
      classes: [
        {
          id: 'class-1',
          name: 'Example',
          covered: 80,
          uncovered: 20,
          percentage: 80,
        },
      ],
      nextCursor: null,
    }),
    chooseImport: async () => preview,
    confirmImport: async () => ({
      orgId: org.id,
      runId: 'new',
      classCount: 1,
      testClassCount: 1,
    }),
    discardImport: async () => {},
    onChanged: () => () => {},
    ...overrides,
  };
  const dispose = mountRuns(screen.document as unknown as Document, api);
  return { ...screen, dispose };
}

test('Apex coverage trends show green up, red down, equals and unavailable states', async () => {
  const s = results({
    coverage: async () => ({
      classes: [
        {
          id: 'up',
          name: 'Improved',
          covered: 80,
          uncovered: 20,
          percentage: 80,
          previousPercentage: 70,
        },
        {
          id: 'down',
          name: 'Decreased',
          covered: 60,
          uncovered: 40,
          percentage: 60,
          previousPercentage: 80,
        },
        {
          id: 'equal',
          name: 'Unchanged',
          covered: 0,
          uncovered: 100,
          percentage: 0,
          previousPercentage: 0,
        },
        {
          id: 'new',
          name: 'New',
          covered: 90,
          uncovered: 10,
          percentage: 90,
          previousPercentage: null,
        },
        {
          id: 'unknown',
          name: 'Unknown',
          covered: 0,
          uncovered: 0,
          percentage: null,
          previousPercentage: 80,
        },
      ],
      nextCursor: null,
    }),
  });
  try {
    await setImmediate();
    const indicators = s
      .node('classes-body')
      .querySelectorAll('.coverage-trend');
    assert.equal(indicators.length, 5);
    assert.equal(indicators[0].classList.contains('coverage-trend-up'), true);
    assert.match(indicators[0].getAttribute('title')!, /70.00% to 80.00%/);
    assert.equal(indicators[1].classList.contains('coverage-trend-down'), true);
    assert.match(indicators[1].getAttribute('aria-label')!, /decreased/);
    assert.equal(indicators[2].textContent, '=');
    assert.equal(indicators[3].textContent, '—');
    assert.equal(indicators[4].textContent, '—');
  } finally {
    s.dispose();
  }
});

test('home shows the org list with manual add and JSON import actions', async () => {
  const s = home();
  try {
    await setImmediate();
    assert.equal(s.node('org-screen').hidden, false);
    assert.equal(s.node('run-screen').hidden, true);
    assert.equal(s.node('org-screen').querySelector('#import-button'), null);
    assert.ok(s.node('org-screen').querySelector('#org-import-button'));
    assert.equal(s.node('empty-state').hidden, false);
    s.click('add-org-button');
    assert.equal(s.node('add-org-dialog').hasAttribute('open'), true);
  } finally {
    s.dispose();
  }
});

test('org list import prefills JSON identity, confirms once and refreshes organizations', async () => {
  let listCalls = 0;
  const confirmations: unknown[] = [];
  const s = home({
    chooseImport: async () => ({
      ...preview,
      orgId: org.id,
      hostName: org.hostName,
    }),
    list: async () => {
      listCalls++;
      return { orgs: listCalls > 1 ? [org] : [], nextCursor: null };
    },
    confirmImport: async (input) => {
      confirmations.push(input);
      return { orgId: org.id, runId: 'new', classCount: 1, testClassCount: 1 };
    },
  });
  try {
    await setImmediate();
    s.click('org-import-button');
    await setImmediate();
    assert.equal(s.node('import-dialog').hasAttribute('open'), true);
    assert.equal(s.node('import-identity').hidden, false);
    assert.equal(
      (s.node('import-org-id') as unknown as HTMLInputElement).value,
      org.id,
    );
    assert.equal(
      (s.node('import-org-hostname') as unknown as HTMLInputElement).value,
      org.hostName,
    );
    s.submit('import-form');
    s.submit('import-form');
    await setImmediate();
    assert.deepEqual(confirmations, [
      { token: preview.token, orgId: org.id, hostName: org.hostName },
    ]);
    assert.equal(s.node('import-dialog').hasAttribute('open'), false);
    assert.equal(s.node('org-list').children.length, 1);
  } finally {
    s.dispose();
  }
});

test('empty org list import accepts missing identity and cancellation discards its preview', async () => {
  const discarded: string[] = [];
  const s = home({
    chooseImport: async () => preview,
    discardImport: async (token) => {
      discarded.push(token);
    },
  });
  try {
    await setImmediate();
    s.click('empty-org-import-button');
    await setImmediate();
    assert.equal(
      (s.node('import-org-id') as unknown as HTMLInputElement).readOnly,
      false,
    );
    assert.equal(
      (s.node('import-org-id') as unknown as HTMLInputElement).value,
      '',
    );
    s.click('cancel-import');
    await setImmediate();
    assert.deepEqual(discarded, [preview.token]);
    assert.equal(s.node('import-dialog').hasAttribute('open'), false);
  } finally {
    s.dispose();
  }
});

test('list import errors stay in the list window and do not create an org', async () => {
  let adds = 0;
  const s = home({
    chooseImport: async () => {
      throw new Error('Invalid JSON');
    },
    add: async () => {
      adds++;
      return org;
    },
  });
  try {
    await setImmediate();
    s.click('org-import-button');
    await setImmediate();
    assert.equal(s.node('notice').hidden, false);
    assert.match(s.node('notice').textContent!, /Invalid JSON/);
    assert.equal(adds, 0);
  } finally {
    s.dispose();
  }
});

test('adding an org creates it without importing results, then refreshes the list', async () => {
  let added: unknown;
  let saved = false;
  const s = home({
    list: async () => ({ orgs: saved ? [org] : [], nextCursor: null }),
    add: async (input) => {
      added = input;
      saved = true;
      return org;
    },
  });
  try {
    await setImmediate();
    s.click('add-org-button');
    (s.node('add-org-id') as HTMLInputElement).value = org.id;
    (s.node('add-org-hostname') as HTMLInputElement).value = org.hostName!;
    s.submit('add-org-form');
    await setImmediate();
    assert.deepEqual(added, { id: org.id, hostName: org.hostName });
    assert.equal(s.node('add-org-dialog').hasAttribute('open'), false);
    assert.match(s.node('org-list').textContent, /example.my.salesforce.com/);
  } finally {
    s.dispose();
  }
});

test('opening the same org twice dispatches two opens and renders names safely', async () => {
  const opened: string[] = [];
  const s = home({
    list: async () => ({
      orgs: [{ ...org, hostName: '<img src=x>' }],
      nextCursor: null,
    }),
    open: async (id) => {
      opened.push(id);
    },
  });
  try {
    await setImmediate();
    const button = s.node('org-list').querySelector('button')!;
    button.dispatchEvent(new s.window.Event('click', { bubbles: true }));
    button.dispatchEvent(new s.window.Event('click', { bubbles: true }));
    await setImmediate();
    assert.deepEqual(opened, [org.id, org.id]);
    assert.equal(s.node('org-list').querySelector('img'), null);
  } finally {
    s.dispose();
  }
});

test('org windows default to the latest run and keep independent selected runs', async () => {
  const a = results();
  const b = results();
  try {
    await setImmediate();
    assert.equal(a.node('org-screen').hidden, true);
    await drill(a);
    await drill(b);
    assert.match(a.node('methods-body').textContent, /method-new/);
    assert.equal(a.node('run-id').textContent, 'new');
    (a.node('run-select') as HTMLSelectElement).value = 'old';
    a.node('run-select').dispatchEvent(new a.window.Event('change'));
    await setImmediate();
    await drill(a);
    assert.match(a.node('methods-body').textContent, /method-old/);
    assert.equal(a.node('methods-body').querySelector('script'), null);
    assert.match(b.node('methods-body').textContent, /method-new/);
    assert.equal(b.node('run-id').textContent, 'new');
    a.click('latest-run-button');
    await setImmediate();
    assert.equal(a.node('run-id').textContent, 'new');
  } finally {
    a.dispose();
    b.dispose();
  }
});

test('org import preserves preview cancellation and retryable validation errors', async () => {
  let discarded: string | undefined;
  let fail = true;
  let received: string | undefined;
  const s = results({
    discardImport: async (token) => {
      discarded = token;
    },
    confirmImport: async (token) => {
      received = token;
      if (fail) throw new Error('Invalid source');
      return { orgId: org.id, runId: 'new', classCount: 1, testClassCount: 1 };
    },
  });
  try {
    await setImmediate();
    s.click('import-button');
    await setImmediate();
    assert.equal(s.node('import-dialog').hasAttribute('open'), true);
    assert.match(
      s.node('import-target').textContent,
      /example.my.salesforce.com/,
    );
    s.click('cancel-import');
    await setImmediate();
    assert.equal(discarded, preview.token);
    s.click('import-button');
    await setImmediate();
    s.submit('import-form');
    await setImmediate();
    assert.equal(s.node('import-dialog').hasAttribute('open'), true);
    assert.match(s.node('import-error').textContent, /Invalid source/);
    fail = false;
    s.submit('import-form');
    await setImmediate();
    assert.equal(received, preview.token);
    assert.equal(s.node('import-dialog').hasAttribute('open'), false);
    assert.equal(s.node('run-id').textContent, 'new');
  } finally {
    s.dispose();
  }
});

test('an org with no runs offers JSON import and picker cancellation stays silent', async () => {
  const s = results({
    list: async () => ({ runs: [], nextCursor: null }),
    chooseImport: async () => null,
  });
  try {
    await setImmediate();
    assert.equal(s.node('no-runs').hidden, false);
    s.click('empty-import-button');
    await setImmediate();
    assert.equal(s.node('import-dialog').hasAttribute('open'), false);
    assert.equal(s.node('run-notice').hidden, true);
  } finally {
    s.dispose();
  }
});

async function clickRow(
  s: ReturnType<typeof results>,
  id: string,
  index = 0,
): Promise<void> {
  const button = s.node(id).querySelectorAll('button')[index];
  assert.ok(button, 'expected selectable row');
  button.dispatchEvent(new s.window.Event('click', { bubbles: true }));
  await setImmediate();
}
async function drill(s: ReturnType<typeof results>): Promise<void> {
  await clickRow(s, 'classes-body');
  await clickRow(s, 'test-classes-body');
}

test('class and test-class clicks populate exactly the three dependent tables', async () => {
  const s = results();
  try {
    await setImmediate();
    assert.equal(s.node('run-content').querySelectorAll('table').length, 3);
    assert.match(s.node('classes-body').textContent, /80.00%/);
    assert.equal(s.node('test-classes-body').children.length, 0);
    assert.equal(s.node('methods-body').children.length, 0);
    await clickRow(s, 'classes-body');
    assert.match(s.node('test-classes-body').textContent, /ExampleTest/);
    assert.match(s.node('test-classes-body').textContent, /60.00%/);
    assert.equal(s.node('methods-body').children.length, 0);
    await clickRow(s, 'test-classes-body');
    assert.match(s.node('methods-body').textContent, /method-new/);
    assert.match(s.node('methods-body').textContent, /Passed/);
    assert.match(s.node('methods-body').textContent, /30.00%/);
    (s.node('run-select') as HTMLSelectElement).value = 'old';
    s.node('run-select').dispatchEvent(new s.window.Event('change'));
    assert.equal(s.node('test-classes-body').children.length, 0);
    assert.equal(s.node('methods-body').children.length, 0);
  } finally {
    s.dispose();
  }
});

test('out-of-order class responses cannot overwrite a newer parent selection', async () => {
  let resolveFirst: (value: unknown) => void = () => {};
  const s = results({
    coverage: async () => ({
      classes: [
        { id: 'class-a', name: 'A', covered: 1, uncovered: 1, percentage: 50 },
        { id: 'class-b', name: 'B', covered: 1, uncovered: 0, percentage: 100 },
      ],
      nextCursor: null,
    }),
    coveringTests: async (_run, id) =>
      id === 'class-a'
        ? await new Promise((resolve) => {
            resolveFirst = resolve;
          })
        : {
            classes: [{ id: 'test-b', name: 'TestB', percentage: 100 }],
            nextCursor: null,
          },
  });
  try {
    await setImmediate();
    await clickRow(s, 'classes-body', 0);
    await clickRow(s, 'classes-body', 1);
    assert.match(s.node('test-classes-body').textContent, /TestB/);
    resolveFirst({
      classes: [{ id: 'test-a', name: 'StaleTestA', percentage: 50 }],
      nextCursor: null,
    });
    await setImmediate();
    assert.match(s.node('test-classes-body').textContent, /TestB/);
    assert.doesNotMatch(s.node('test-classes-body').textContent, /StaleTestA/);
  } finally {
    s.dispose();
  }
});

test('run picklist includes all history pages while detailed data stays lazy', async () => {
  const ids: (string | undefined)[] = [];
  let detailCalls = 0;
  const summaries = Array.from({ length: 61 }, (_, i) => ({
    id: 'run-' + i,
    startTime: null,
    percentage: null,
    status: 'Completed',
    testsRun: 1,
    failures: 0,
  }));
  const s = results({
    list: async (cursor) => {
      ids.push(cursor?.id);
      return cursor
        ? { runs: summaries.slice(50), nextCursor: null }
        : {
            runs: summaries.slice(0, 50),
            nextCursor: { date: '', id: 'run-49' },
          };
    },
    coveringTests: async () => {
      detailCalls++;
      return { classes: [], nextCursor: null };
    },
  });
  try {
    await setImmediate();
    assert.equal(s.node('run-select').querySelectorAll('option').length, 61);
    assert.deepEqual(ids, [undefined, 'run-49']);
    assert.equal(detailCalls, 0);
  } finally {
    s.dispose();
  }
});

test('right-click opens history for the clicked Apex class without changing drill-down selection', async () => {
  const opened: string[] = [];
  const s = results({
    openHistory: async (id) => {
      opened.push(id);
    },
  });
  try {
    await setImmediate();
    const row = s.node('classes-body').querySelector('tr')!;
    const event = new s.window.Event('contextmenu', {
      bubbles: true,
      cancelable: true,
    });
    row.dispatchEvent(event);
    await setImmediate();
    assert.equal(event.defaultPrevented, true);
    assert.deepEqual(opened, ['class-1']);
    assert.equal(s.node('test-classes-body').children.length, 0);
    row.dispatchEvent(
      new s.window.Event('contextmenu', { bubbles: true, cancelable: true }),
    );
    await setImmediate();
    assert.deepEqual(opened, ['class-1', 'class-1']);
  } finally {
    s.dispose();
  }
});

test('first-table coverage colors use exact boundaries and leave above-80 and unknown rows normal', async () => {
  const scores = [0, 74.99, 75, 80, 80.01, null];
  const s = results({
    coverage: async () => ({
      classes: scores.map((percentage, i) => ({
        id: `class-${i}`,
        name: `Class${i}`,
        covered: null,
        uncovered: null,
        percentage,
      })),
      nextCursor: null,
    }),
  });
  try {
    await setImmediate();
    const rows = s.node('classes-body').querySelectorAll('tr');
    assert.equal(rows[0].classList.contains('coverage-red'), true);
    assert.equal(rows[1].classList.contains('coverage-red'), true);
    assert.equal(rows[2].classList.contains('coverage-yellow'), true);
    assert.equal(rows[3].classList.contains('coverage-yellow'), true);
    assert.equal(rows[4].classList.contains('coverage-red'), false);
    assert.equal(rows[4].classList.contains('coverage-yellow'), false);
    assert.equal(rows[5].classList.contains('coverage-yellow'), false);
    assert.equal(s.document.querySelector('.pagination'), null);
    assert.equal(s.document.querySelector('#classes-next'), null);
  } finally {
    s.dispose();
  }
});

test('org deletion refreshes after confirmation and never opens the org window', async () => {
  let deleted = false;
  let opened = false;
  const s = home({
    list: async () => ({ orgs: deleted ? [] : [org], nextCursor: null }),
    remove: async (id) => {
      assert.equal(id, org.id);
      deleted = true;
      return true;
    },
    open: async () => {
      opened = true;
    },
  });
  try {
    await setImmediate();
    s.node('org-list')
      .querySelector('button[data-delete-org-id]')!
      .dispatchEvent(new s.window.Event('click', { bubbles: true }));
    await setImmediate();
    assert.equal(deleted, true);
    assert.equal(opened, false);
    assert.equal(s.node('org-list').children.length, 0);
    assert.equal(s.node('empty-state').hidden, false);
  } finally {
    s.dispose();
  }
});

test('canceling the native deletion confirmation keeps the org visible', async () => {
  const s = home({
    list: async () => ({ orgs: [org], nextCursor: null }),
    remove: async () => false,
  });
  try {
    await setImmediate();
    s.node('org-list')
      .querySelector('button[data-delete-org-id]')!
      .dispatchEvent(new s.window.Event('click', { bubbles: true }));
    await setImmediate();
    assert.equal(s.node('org-list').children.length, 1);
  } finally {
    s.dispose();
  }
});

test('headers toggle server-side sorting and inactive child tables do not fetch without a selection', async () => {
  const sorts: unknown[] = [];
  let childCalls = 0;
  const s = results({
    coverage: async (_run, after, sort) => {
      sorts.push({ after, sort });
      return {
        classes: [
          {
            id: 'class-1',
            name: 'Example',
            percentage: 80,
            covered: 80,
            uncovered: 20,
          },
        ],
        nextCursor: null,
      };
    },
    coveringTests: async () => {
      childCalls++;
      return { classes: [], nextCursor: null };
    },
  });
  try {
    await setImmediate();
    const header = s.node('classes-panel').querySelectorAll('thead button')[1]!;
    header.dispatchEvent(new s.window.Event('click'));
    await setImmediate();
    assert.deepEqual(sorts.at(-1), {
      after: '',
      sort: { column: 'percentage', direction: 'asc' },
    });
    assert.equal(header.closest('th')!.getAttribute('aria-sort'), 'ascending');
    header.dispatchEvent(new s.window.Event('click'));
    await setImmediate();
    assert.deepEqual(sorts.at(-1), {
      after: '',
      sort: { column: 'percentage', direction: 'desc' },
    });
    s.node('test-classes-panel')
      .querySelector('thead button')!
      .dispatchEvent(new s.window.Event('click'));
    await setImmediate();
    assert.equal(childCalls, 0);
  } finally {
    s.dispose();
  }
});
