import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import type { BrowserWindow, IpcMainInvokeEvent } from 'electron';
import { LocalStore } from '../src/main/database/store';
import { WindowRegistry } from '../src/main/windows/window-registry';
import { authorizeAppSender } from '../src/main/security/authorize-sender';

const ID = '00D000000000001EAA';
const OTHER = '00D000000000002EAA';
const source = readFileSync(
  new URL('../examples/deployment-result.json', import.meta.url),
  'utf8',
);
function fixture() {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'apex-multiwindow-'));
  const filename = path.join(directory, 'application.sqlite');
  const store = new LocalStore(filename);
  const inspector = new DatabaseSync(filename);
  return {
    store,
    inspector,
    filename,
    directory,
    cleanup() {
      inspector.close();
      store.close();
      rmSync(directory, { recursive: true, force: true });
    },
  };
}

test('list import creates org and run atomically, reuses existing identity and keeps session ownership', () => {
  const f = fixture();
  try {
    const raw = JSON.parse(source);
    raw.result.orgId = ID;
    raw.result.hostname = 'https://example.my.salesforce.com';
    const preview = f.store.orgs.prepareJson(
      JSON.stringify(raw),
      'from-list.json',
      'list-window',
    );
    assert.equal(f.store.orgs.list().orgs.length, 0);
    assert.throws(
      () =>
        f.store.orgs.commit(
          preview.token,
          ID,
          'example.my.salesforce.com',
          'other-window',
        ),
      /expired/,
    );
    f.inspector.exec(
      "CREATE TRIGGER fail_list_import BEFORE INSERT ON RunReport BEGIN SELECT RAISE(ABORT, 'test failure'); END",
    );
    assert.throws(
      () =>
        f.store.orgs.commit(
          preview.token,
          ID,
          'example.my.salesforce.com',
          'list-window',
        ),
      /test failure/,
    );
    assert.equal(f.store.orgs.list().orgs.length, 0);
    f.inspector.exec('DROP TRIGGER fail_list_import');
    f.store.orgs.commit(
      preview.token,
      ID,
      'example.my.salesforce.com',
      'list-window',
    );
    assert.equal(f.store.orgs.get(ID).runCount, 1);
    const again = f.store.orgs.prepareJson(
      JSON.stringify(raw),
      'from-list.json',
      'list-window',
    );
    f.store.orgs.commit(
      again.token,
      ID,
      'example.my.salesforce.com',
      'list-window',
    );
    assert.equal(f.store.orgs.list().orgs.length, 1);
    assert.equal(f.store.orgs.get(ID).runCount, 1);
  } finally {
    f.cleanup();
  }
});

test('adding an org requires no run and duplicate adds do not rename existing orgs', () => {
  const f = fixture();
  try {
    const org = f.store.orgs.add(ID, 'example.my.salesforce.com');
    assert.equal(org.runCount, 0);
    assert.deepEqual(f.store.orgs.runs(ID), { runs: [], nextCursor: null });
    assert.throws(
      () => f.store.orgs.add(ID, 'other.my.salesforce.com'),
      /already exists/,
    );
    assert.equal(f.store.orgs.get(ID).hostName, 'example.my.salesforce.com');
  } finally {
    f.cleanup();
  }
});

test('two windows of the same org retain independent previews and cannot consume each other tokens', () => {
  const f = fixture();
  try {
    f.store.orgs.add(ID, 'example.my.salesforce.com');
    const first = f.store.orgs.prepareJson(
      source,
      'first.json',
      'window-1',
      ID,
    );
    const nextSource = JSON.parse(source);
    nextSource.result.id = 'second-run';
    const second = f.store.orgs.prepareJson(
      JSON.stringify(nextSource),
      'second.json',
      'window-2',
      ID,
    );
    assert.throws(
      () =>
        f.store.orgs.commit(
          first.token,
          ID,
          'example.my.salesforce.com',
          'window-2',
        ),
      /expired/,
    );
    f.store.orgs.discard(first.token, 'window-2');
    f.store.orgs.commit(
      first.token,
      ID,
      'example.my.salesforce.com',
      'window-1',
    );
    f.store.orgs.commit(
      second.token,
      ID,
      'example.my.salesforce.com',
      'window-2',
    );
    assert.equal(f.store.orgs.get(ID).runCount, 2);
    const third = f.store.orgs.prepareJson(
      source,
      'third.json',
      'window-3',
      ID,
    );
    f.store.orgs.releaseSession('window-3');
    assert.throws(
      () =>
        f.store.orgs.commit(
          third.token,
          ID,
          'example.my.salesforce.com',
          'window-3',
        ),
      /expired/,
    );
  } finally {
    f.cleanup();
  }
});

test('an org window rejects another org JSON and cannot redirect its staged import', () => {
  const f = fixture();
  try {
    f.store.orgs.add(ID, 'example.my.salesforce.com');
    f.store.orgs.add(OTHER, 'other.my.salesforce.com');
    const raw = JSON.parse(source);
    raw.result.orgId = OTHER;
    assert.throws(
      () =>
        f.store.orgs.prepareJson(
          JSON.stringify(raw),
          'other.json',
          'window-1',
          ID,
        ),
      /different organization/,
    );
    const staged = f.store.orgs.prepareJson(
      source,
      'result.json',
      'window-1',
      ID,
    );
    assert.throws(
      () =>
        f.store.orgs.commit(
          staged.token,
          OTHER,
          'other.my.salesforce.com',
          'window-1',
        ),
      /another organization window/,
    );
    assert.equal(f.store.orgs.get(OTHER).runCount, 0);
    f.store.orgs.commit(
      staged.token,
      ID,
      'example.my.salesforce.com',
      'window-1',
    );
    assert.equal(f.store.orgs.tests(OTHER, staged.runId).tests.length, 0);
    assert.equal(f.store.orgs.coverage(OTHER, staged.runId).classes.length, 0);
  } finally {
    f.cleanup();
  }
});

test('latest run is chosen by date, not import order; history cursor handles dates, ties and null dates', () => {
  const f = fixture();
  try {
    f.store.orgs.add(ID, 'example.my.salesforce.com');
    function save(run: string, date: string) {
      const raw = JSON.parse(source);
      raw.result.id = run;
      raw.result.startDate = date;
      const staged = f.store.orgs.prepareJson(
        JSON.stringify(raw),
        'result.json',
      );
      f.store.orgs.commit(staged.token, ID, 'example.my.salesforce.com');
    }
    save('newer', '2026-10-26T10:00:00Z');
    save('older', '2026-10-25T10:00:00Z');
    assert.equal(f.store.orgs.runs(ID).runs[0]?.id, 'newer');
    const insert = f.inspector.prepare(
      'INSERT INTO Run(id, orgId, startTime) VALUES (?, ?, ?)',
    );
    for (let i = 0; i < 120; i++)
      insert.run(
        `historical-${i.toString().padStart(3, '0')}`,
        ID,
        i < 5 ? null : '2026-01-01T00:00:00.000Z',
      );
    const ids: string[] = [];
    let cursor;
    do {
      const page = f.store.orgs.runs(ID, cursor);
      ids.push(...page.runs.map((run) => run.id));
      cursor = page.nextCursor ?? undefined;
    } while (cursor);
    assert.equal(ids.length, 122);
    assert.equal(new Set(ids).size, 122);
    assert.equal(ids[0], 'newer');
    assert.equal(ids[1], 'older');
    assert.equal(ids.at(-1), 'historical-000');
    const plan = f.inspector
      .prepare(
        "EXPLAIN QUERY PLAN SELECT id FROM Run WHERE orgId = ? ORDER BY COALESCE(startTime, '') DESC, id DESC LIMIT 51",
      )
      .all(ID);
    assert.match(JSON.stringify(plan), /Run_org_date/);
  } finally {
    f.cleanup();
  }
});

test('normalized test outcomes are paginated and repeated imports replace only that run outcomes', () => {
  const f = fixture();
  try {
    const raw = JSON.parse(source);
    raw.result.details.runTestResult.numTestsRun = 125;
    raw.result.details.runTestResult.successes = Array.from(
      { length: 125 },
      (_, i) => ({
        id: '01p000000000002AAA',
        name: 'ExampleTest',
        methodName: `method-${i}`,
        time: '1.25',
      }),
    );
    const staged = f.store.orgs.prepareJson(JSON.stringify(raw), 'result.json');
    f.store.orgs.commit(staged.token, ID, 'example.my.salesforce.com');
    const first = f.store.orgs.tests(ID, staged.runId);
    const second = f.store.orgs.tests(ID, staged.runId, first.nextCursor!);
    const third = f.store.orgs.tests(ID, staged.runId, second.nextCursor!);
    assert.equal(first.tests.length, 50);
    assert.equal(second.tests.length, 50);
    assert.equal(third.tests.length, 25);
    assert.equal(first.tests[0]?.duration, 1.25);
    assert.equal(first.tests[0]?.outcome, 'Pass');
    const repeated = f.store.orgs.prepareJson(source, 'repeated.json');
    f.store.orgs.commit(repeated.token, ID, 'example.my.salesforce.com');
    assert.equal(f.store.orgs.tests(ID, staged.runId).tests.length, 1);
    assert.equal(f.store.orgs.runs(ID).runs[0]?.testsRun, 1);
  } finally {
    f.cleanup();
  }
});

test('version-3 archives are backfilled into paginated test results without losing original JSON', () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'apex-v3-upgrade-'));
  const filename = path.join(directory, 'application.sqlite');
  try {
    const first = new LocalStore(filename);
    const preview = first.orgs.prepareJson(source, 'result.json');
    first.orgs.commit(preview.token, ID, 'example.my.salesforce.com');
    first.close();
    const legacy = new DatabaseSync(filename);
    legacy.exec(
      'DROP TABLE RunTestResult; DROP TABLE RunReport; DROP INDEX Run_org_date; DROP INDEX TestClassCoverage_drilldown; DROP INDEX TestMethodCoverage_drilldown; PRAGMA user_version = 3;',
    );
    legacy.close();
    const upgraded = new LocalStore(filename);
    try {
      assert.equal(upgraded.status().schemaVersion, 6);
      assert.equal(
        upgraded.orgs.tests(ID, preview.runId).tests[0]?.methodName,
        'testAccount',
      );
      assert.equal(upgraded.orgs.runs(ID).runs[0]?.status, 'Succeeded');
    } finally {
      upgraded.close();
    }
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

function fakeWindow(id: number) {
  const listeners = new Map<string, () => void>();
  const sent: unknown[] = [];
  let destroyed = false;
  const window = {
    webContents: {
      id,
      mainFrame: { url: 'http://localhost:5173/' },
      send: (...args: unknown[]) => sent.push(args),
    },
    isDestroyed: () => destroyed,
    once: (name: string, callback: () => void) => listeners.set(name, callback),
  };
  return {
    window: window as unknown as BrowserWindow,
    sent,
    close() {
      destroyed = true;
      listeners.get('closed')?.();
    },
  };
}

test('registered duplicate org windows stay authorized independently; closing one leaves the other alive', () => {
  Object.assign(globalThis, {
    MAIN_WINDOW_VITE_DEV_SERVER_URL: 'http://localhost:5173/',
    MAIN_WINDOW_VITE_NAME: 'main_window',
  });
  const registry = new WindowRegistry();
  const first = fakeWindow(1);
  const second = fakeWindow(2);
  const closed: number[] = [];
  registry.register(first.window, { view: 'org', orgId: ID }, (id) =>
    closed.push(id),
  );
  registry.register(second.window, { view: 'org', orgId: ID }, (id) =>
    closed.push(id),
  );
  const event = (window: BrowserWindow) =>
    ({
      sender: window.webContents,
      senderFrame: window.webContents.mainFrame,
    }) as IpcMainInvokeEvent;
  assert.equal(
    authorizeAppSender(event(first.window), (id) => registry.resolve(id)),
    first.window,
  );
  assert.equal(
    authorizeAppSender(event(second.window), (id) => registry.resolve(id)),
    second.window,
  );
  registry.notify(ID, 1);
  assert.equal(first.sent.length, 0);
  assert.equal(second.sent.length, 1);
  first.close();
  assert.deepEqual(closed, [1]);
  assert.equal(registry.resolve(1), null);
  assert.equal(registry.resolve(2), second.window);
  assert.throws(
    () => authorizeAppSender(event(first.window), (id) => registry.resolve(id)),
    /Unauthorized/,
  );
  const forgedFrame = {
    sender: second.window.webContents,
    senderFrame: { url: 'http://localhost:5173/' },
  } as unknown as IpcMainInvokeEvent;
  assert.throws(
    () => authorizeAppSender(forgedFrame, (id) => registry.resolve(id)),
    /Unauthorized/,
  );
  delete (globalThis as Record<string, unknown>)
    .MAIN_WINDOW_VITE_DEV_SERVER_URL;
  delete (globalThis as Record<string, unknown>).MAIN_WINDOW_VITE_NAME;
});

test('deleting an org closes only its org/history windows and preserves the list and other orgs', () => {
  const registry = new WindowRegistry();
  const list = fakeWindow(10);
  const org = fakeWindow(11);
  const history = fakeWindow(12);
  const other = fakeWindow(13);
  for (const entry of [list, org, history, other])
    entry.window.close = entry.close;
  registry.register(list.window, { view: 'orgs' }, () => {});
  registry.register(org.window, { view: 'org', orgId: ID }, () => {});
  registry.register(
    history.window,
    { view: 'class-history', orgId: ID, apexClass: 'class-1' },
    () => {},
  );
  registry.register(other.window, { view: 'org', orgId: OTHER }, () => {});
  registry.closeOrg(ID);
  assert.equal(registry.resolve(11), null);
  assert.equal(registry.resolve(12), null);
  assert.equal(registry.resolve(10), list.window);
  assert.equal(registry.resolve(13), other.window);
});
