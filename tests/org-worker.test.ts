import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { DatabaseClient } from '../src/main/database/client';

test('source worker/client pipeline imports a selected file and survives validation failures', async () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'apex-org-worker-'));
  const client = new DatabaseClient(
    path.join(directory, 'application.sqlite'),
    fileURLToPath(new URL('./helpers/database-worker.cjs', import.meta.url)),
  );
  try {
    assert.equal((await client.status()).schemaVersion, 6);
    const filename = path.join(directory, 'deployment.json');
    writeFileSync(
      filename,
      readFileSync(
        new URL('../examples/deployment-result.json', import.meta.url),
      ),
    );
    const staged = await client.prepareOrgImport(filename);
    await assert.rejects(
      client.commitOrgImport({
        token: staged.token,
        orgId: 'invalid',
        hostName: 'example.com',
      }),
      /org ID/,
    );
    await client.commitOrgImport({
      token: staged.token,
      orgId: '00D000000000001EAA',
      hostName: 'example.my.salesforce.com',
    });
    const page = await client.listOrgs('');
    assert.equal(page.orgs[0]?.runCount, 1);
    assert.equal(page.orgs[0]?.percentage, 80);
    const sortedOrgs = await client.listOrgs('', {
      column: 'hostName',
      direction: 'desc',
    });
    assert.equal(sortedOrgs.orgs[0]?.id, '00D000000000001EAA');
    const sortedClasses = await client.orgCoverage(
      '00D000000000001EAA',
      staged.runId,
      '',
      { column: 'percentage', direction: 'desc' },
    );
    assert.equal(sortedClasses.classes[0]?.percentage, 80);
    const identity = await client.classHistoryIdentity(
      '00D000000000001EAA',
      '01p000000000001AAA',
    );
    assert.equal(identity.className, 'AccountService');
    const history = await client.classHistory(
      identity.orgId,
      identity.classId,
      {
        from: '2026-10-26T00:00:00.000Z',
        toExclusive: '2026-10-27T00:00:00.000Z',
      },
    );
    assert.equal(history.totalRuns, 1);
    assert.equal(history.points[0]?.percentage, 80);
    writeFileSync(filename, '{}');
    await assert.rejects(client.prepareOrgImport(filename), /runTestResult/);
    assert.equal((await client.listOrgs('')).orgs.length, 1);
  } finally {
    await client.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
