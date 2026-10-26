import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import { migrate } from '../src/main/database/migrations';
import {
  CoverageHistoryRepository,
  historyRange,
} from '../src/main/features/coverage-history/repository';
import { selectedRange } from '../src/renderer/features/history/date-range';

const ORG = '00D000000000001EAA';
const OTHER = '00D000000000002EAA';
const RANGE = {
  from: '2026-01-01T00:00:00.000Z',
  toExclusive: '2027-01-01T00:00:00.000Z',
};
function fixture() {
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys = ON');
  migrate(db);
  for (const id of [ORG, OTHER]) {
    db.prepare('INSERT INTO Org(id, hostName) VALUES (?, ?)').run(
      id,
      `${id}.example.com`,
    );
    db.prepare('INSERT INTO ApexClass(id, orgId, name) VALUES (?, ?, ?)').run(
      'class-1',
      id,
      'DemoClass',
    );
  }
  const history = new CoverageHistoryRepository(db);
  function save(
    id: string,
    date: string | null,
    covered: number,
    uncovered = 100 - covered,
    org = ORG,
  ) {
    db.prepare('INSERT INTO Run(id, orgId, startTime) VALUES (?, ?, ?)').run(
      id,
      org,
      date,
    );
    db.prepare(
      'INSERT INTO GlobalCoverage(apexClass, run, orgId, numLineCovered, numLineUncovered) VALUES (?, ?, ?, ?, ?)',
    ).run('class-1', id, org, covered, uncovered);
  }
  return { db, history, save };
}

test('history filters dates and org/class scope, orders runs, and preserves zero/unknown coverage', () => {
  const f = fixture();
  try {
    f.save('new', '2026-10-26T18:00:00.000Z', 80);
    f.save('old', '2026-10-25T10:00:00.000Z', 0);
    f.save('unknown', '2026-10-26T12:00:00.000Z', 0, 0);
    f.save('undated', null, 90);
    f.save('other', '2026-10-26T18:00:00.000Z', 100, 0, OTHER);
    const meta = f.history.current(ORG, 'class-1');
    assert.equal(meta.firstDate, '2026-10-25T10:00:00.000Z');
    assert.equal(meta.undatedRuns, 1);
    const all = f.history.query(ORG, 'class-1', RANGE);
    assert.equal(all.totalRuns, 3);
    assert.equal(all.aggregated, false);
    assert.deepEqual(
      all.points.map((point) => point.percentage),
      [0, null, 80],
    );
    const narrow = f.history.query(ORG, 'class-1', {
      from: '2026-10-26T00:00:00.000Z',
      toExclusive: '2026-10-26T18:00:00.000Z',
    });
    assert.equal(narrow.totalRuns, 1);
    assert.equal(
      narrow.points[0]?.runId,
      'unknown',
      'upper boundary is exclusive',
    );
    assert.equal(f.history.query(ORG, 'missing', RANGE).totalRuns, 0);
    assert.throws(() => f.history.current(ORG, 'missing'), /does not exist/);
    assert.equal(
      f.history.query(OTHER, 'class-1', RANGE).points[0]?.percentage,
      100,
    );
  } finally {
    f.db.close();
  }
});

test('long histories are reduced to at most 500 buckets while retaining counts and min/max', () => {
  const f = fixture();
  try {
    f.db.exec('BEGIN');
    for (let i = 0; i < 1500; i++)
      f.save(
        `run-${i}`,
        new Date(Date.UTC(2026, 0, 1) + i * 3600000).toISOString(),
        i % 101,
      );
    f.db.exec('COMMIT');
    const result = f.history.query(ORG, 'class-1', RANGE);
    assert.equal(result.aggregated, true);
    assert.equal(result.totalRuns, 1500);
    assert.ok(result.points.length <= 500);
    assert.equal(
      result.points.reduce((total, point) => total + point.count, 0),
      1500,
    );
    assert.ok(
      result.points.every(
        (point) =>
          point.runId === null &&
          point.minimum! <= point.percentage! &&
          point.maximum! >= point.percentage!,
      ),
    );
  } finally {
    f.db.close();
  }
});

test('date selection validates ordering and includes the full local end day across DST', () => {
  assert.throws(
    () => historyRange({ from: 'wrong', toExclusive: RANGE.toExclusive }),
    /Invalid/,
  );
  assert.throws(
    () => historyRange({ from: RANGE.toExclusive, toExclusive: RANGE.from }),
    /end date/,
  );
  assert.throws(() => selectedRange('2026-02-30', '2026-03-01'), /valid/);
  assert.throws(() => selectedRange('2026-10-26', '2026-10-25'), /end date/);
  const prior = process.env.TZ;
  process.env.TZ = 'Europe/Paris';
  try {
    const spring = selectedRange('2026-03-29', '2026-03-29');
    assert.equal(
      Date.parse(spring.toExclusive) - Date.parse(spring.from),
      23 * 3600000,
    );
    const fall = selectedRange('2026-10-25', '2026-10-25');
    assert.equal(
      Date.parse(fall.toExclusive) - Date.parse(fall.from),
      25 * 3600000,
    );
  } finally {
    if (prior === undefined) delete process.env.TZ;
    else process.env.TZ = prior;
  }
});
