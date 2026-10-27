import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { migrate } from '../src/main/database/migrations';
import { OrgRepository } from '../src/main/features/orgs/repository';

const ORG = '00D000000000001EAA';
const OTHER = '00D000000000002EAA';
const CLASS = '01p000000000001AAA';

test('coverage compares the immediately preceding dated org run, including historical selections, ties and missing data', () => {
  const db = new DatabaseSync(':memory:');
  migrate(db);
  const repository = new OrgRepository(db);
  try {
    for (const org of [ORG, OTHER]) {
      db.prepare('INSERT INTO Org(id) VALUES (?)').run(org);
      db.prepare('INSERT INTO ApexClass(id, orgId, name) VALUES (?, ?, ?)').run(
        CLASS,
        org,
        'Service',
      );
    }
    const run = db.prepare(
      'INSERT INTO Run(id, orgId, startTime) VALUES (?, ?, ?)',
    );
    run.run('z-old', ORG, '2026-01-01T00:00:00.000Z');
    run.run('y-middle', ORG, '2026-02-01T00:00:00.000Z');
    run.run('a-latest', ORG, '2026-03-01T00:00:00.000Z');
    run.run('b-tie', ORG, '2026-03-01T00:00:00.000Z');
    run.run('undated', ORG, null);
    run.run('foreign', OTHER, '2026-02-28T00:00:00.000Z');
    const coverage = db.prepare(
      'INSERT INTO GlobalCoverage(apexClass, orgId, run, numLineCovered, numLineUncovered) VALUES (?, ?, ?, ?, ?)',
    );
    coverage.run(CLASS, ORG, 'z-old', 0, 100);
    coverage.run(CLASS, ORG, 'y-middle', 70, 30);
    coverage.run(CLASS, ORG, 'a-latest', 80, 20);
    coverage.run(CLASS, ORG, 'b-tie', 80, 20);
    coverage.run(CLASS, ORG, 'undated', 60, 40);
    coverage.run(CLASS, OTHER, 'foreign', 99, 1);
    const previous = (id: string) =>
      repository.coverage(ORG, id).classes[0]?.previousPercentage;
    assert.equal(previous('z-old'), null);
    assert.equal(previous('y-middle'), 0);
    assert.equal(previous('a-latest'), 70);
    assert.equal(previous('b-tie'), 80);
    assert.equal(previous('undated'), null);
    db.prepare('DELETE FROM GlobalCoverage WHERE orgId = ? AND run = ?').run(
      ORG,
      'y-middle',
    );
    assert.equal(
      previous('a-latest'),
      null,
      'do not silently compare with an older run when the immediately preceding run lacks this class',
    );
    coverage.run(CLASS, ORG, 'y-middle', 0, 0);
    assert.equal(
      previous('a-latest'),
      null,
      'unknown previous coverage is not zero',
    );
  } finally {
    repository.dispose();
    db.close();
  }
});

test('coverage comparisons are returned across every sorted cursor batch', () => {
  const db = new DatabaseSync(':memory:');
  migrate(db);
  const repository = new OrgRepository(db);
  try {
    db.prepare('INSERT INTO Org(id) VALUES (?)').run(ORG);
    db.prepare('INSERT INTO Run(id, orgId, startTime) VALUES (?, ?, ?)').run(
      'old',
      ORG,
      '2026-01-01T00:00:00.000Z',
    );
    db.prepare('INSERT INTO Run(id, orgId, startTime) VALUES (?, ?, ?)').run(
      'new',
      ORG,
      '2026-02-01T00:00:00.000Z',
    );
    for (let i = 0; i < 125; i++) {
      const id = `01p${String(i).padStart(12, '0')}`;
      db.prepare('INSERT INTO ApexClass(id, orgId, name) VALUES (?, ?, ?)').run(
        id,
        ORG,
        `Class ${i}`,
      );
      for (const [run, covered] of [
        ['old', 25],
        ['new', i % 100],
      ] as const)
        db.prepare(
          'INSERT INTO GlobalCoverage(apexClass, orgId, run, numLineCovered, numLineUncovered) VALUES (?, ?, ?, ?, ?)',
        ).run(id, ORG, run, covered, 100 - covered);
    }
    let cursor = '';
    const ids = new Set<string>();
    do {
      const page = repository.coverage(ORG, 'new', cursor, {
        column: 'percentage',
        direction: 'desc',
      });
      for (const row of page.classes) {
        assert.equal(row.previousPercentage, 25);
        ids.add(row.id);
      }
      cursor = page.nextCursor ?? '';
    } while (cursor);
    assert.equal(ids.size, 125);
  } finally {
    repository.dispose();
    db.close();
  }
});
