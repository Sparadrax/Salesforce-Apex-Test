import assert from 'node:assert/strict';
import { readFileSync, readdirSync, mkdtempSync, rmSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { LocalStore } from '../src/main/database/store';
import { parseDeployment } from '../src/main/features/orgs/parse-deployment';

test('six demo history files preserve class identities and create seven distinct dated graph points with the original', () => {
  const folder = fileURLToPath(
    new URL('../examples/history/', import.meta.url),
  );
  const files = readdirSync(folder)
    .filter((name) => name.endsWith('.json'))
    .sort();
  assert.equal(files.length, 6);
  const original = readFileSync(
    new URL('../examples/deployment-demo-50-classes.json', import.meta.url),
    'utf8',
  );
  const identity = parseDeployment(original);
  const directory = mkdtempSync(path.join(os.tmpdir(), 'apex-demo-history-'));
  const store = new LocalStore(path.join(directory, 'application.sqlite'));
  const runIds = new Set<string>();
  const dates = new Set<string>();
  try {
    for (const source of [
      ...files.map((name) => readFileSync(path.join(folder, name), 'utf8')),
      original,
    ]) {
      const data = parseDeployment(source);
      assert.equal(data.classes.length, 50);
      assert.equal(data.testClasses.length, 50);
      assert.equal(data.tests.length, 249);
      assert.deepEqual(
        data.classes.map((row) => row.id),
        identity.classes.map((row) => row.id),
      );
      assert.equal(data.orgId, '00D000000000001EAA');
      for (const testClass of data.testClasses) {
        const count = data.tests.filter(
          (row) => row.classId === testClass.id,
        ).length;
        assert.ok(count >= 4 && count <= 6);
      }
      runIds.add(data.runId);
      dates.add(data.startTime!);
      const preview = store.orgs.prepareJson(source, 'history.json');
      store.orgs.commit(
        preview.token,
        data.orgId!,
        'apex-demo.my.salesforce.com',
      );
    }
    assert.equal(runIds.size, 7);
    assert.equal(dates.size, 7);
    assert.equal(store.orgs.get(identity.orgId!).runCount, 7);
    const graph = store.history.query(
      identity.orgId!,
      identity.classes[0]!.id,
      {
        from: '2026-10-01T00:00:00.000Z',
        toExclusive: '2026-11-01T00:00:00.000Z',
      },
    );
    assert.equal(graph.points.length, 7);
    assert.equal(
      new Set(graph.points.map((point) => point.percentage)).size,
      7,
    );
    assert.deepEqual(
      graph.points.map((point) => point.at.slice(0, 10)),
      [
        '2026-10-08',
        '2026-10-11',
        '2026-10-14',
        '2026-10-17',
        '2026-10-20',
        '2026-10-23',
        '2026-10-26',
      ],
    );
    console.log(
      'Validated seven distinct history points including the original demo.',
    );
  } finally {
    store.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
