import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { setImmediate } from 'node:timers/promises';
import { test } from 'node:test';
import { parseHTML } from 'linkedom';
import { mountHistory } from '../src/renderer/features/history/history';
import { drawHistory } from '../src/renderer/features/history/chart';
import type {
  CoverageHistoryApi,
  HistoryRange,
} from '../src/shared/contracts/coverage-history';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
function screen(overrides: Partial<CoverageHistoryApi> = {}) {
  const { document, window } = parseHTML(html);
  Object.assign(document.getElementById('history-form')!, {
    reportValidity: () => true,
  });
  const ranges: HistoryRange[] = [];
  const api: CoverageHistoryApi = {
    current: async () => ({
      orgId: 'org-1',
      hostName: 'demo.example.com',
      classId: 'class-1',
      className: 'DemoClass',
      firstDate: '2026-10-25T12:00:00.000Z',
      lastDate: '2026-10-26T12:00:00.000Z',
      undatedRuns: 0,
    }),
    query: async (range) => {
      ranges.push(range);
      return {
        totalRuns: 1,
        aggregated: false,
        points: [
          {
            at: '2026-10-26T12:00:00.000Z',
            percentage: 80,
            minimum: 80,
            maximum: 80,
            count: 1,
            runId: 'run-1',
          },
        ],
      };
    },
    onChanged: () => () => {},
    ...overrides,
  };
  const dispose = mountHistory(document as unknown as Document, api);
  const node = (id: string) => document.getElementById(id)!;
  return { document, window, node, dispose, ranges };
}

test('history window renders a one-point graph and applies inclusive date ranges', async () => {
  const s = screen();
  try {
    await setImmediate();
    assert.equal(s.node('history-screen').hidden, false);
    assert.equal(s.node('run-screen').hidden, true);
    assert.equal(s.node('history-class').textContent, 'DemoClass');
    assert.equal(s.node('history-chart').querySelectorAll('circle').length, 1);
    assert.match(s.node('history-chart').textContent, /80.00%/);
    (s.node('history-from') as HTMLInputElement).value = '2026-10-20';
    (s.node('history-through') as HTMLInputElement).value = '2026-10-26';
    s.node('history-form').dispatchEvent(
      new s.window.Event('submit', { cancelable: true }),
    );
    await setImmediate();
    assert.equal(s.ranges.length, 2);
    assert.match(s.node('history-range-label').textContent, /2026-10-20/);
    (s.node('history-from') as HTMLInputElement).value = '2026-10-30';
    s.node('history-form').dispatchEvent(
      new s.window.Event('submit', { cancelable: true }),
    );
    await setImmediate();
    assert.equal(s.ranges.length, 2);
    assert.equal(s.node('history-error').hidden, false);
  } finally {
    s.dispose();
  }
});

test('SVG preserves gaps for unknown percentages and treats 0% as valid data', () => {
  const { document } = parseHTML('<div id="chart"></div>');
  const container = document.getElementById('chart')!;
  drawHistory(
    document as unknown as Document,
    container as unknown as HTMLElement,
    {
      totalRuns: 3,
      aggregated: false,
      points: [0, null, 100].map((value, i) => ({
        at: `2026-10-${24 + i}T12:00:00.000Z`,
        percentage: value,
        minimum: value,
        maximum: value,
        count: 1,
        runId: `<script>run-${i}</script>`,
      })),
    },
  );
  assert.equal(container.querySelectorAll('circle').length, 2);
  assert.equal(container.querySelector('script'), null);
  assert.equal(
    (container.querySelector('path')?.getAttribute('d')?.match(/M/g) ?? [])
      .length,
    2,
  );
  drawHistory(
    document as unknown as Document,
    container as unknown as HTMLElement,
    { totalRuns: 0, aggregated: false, points: [] },
  );
  assert.match(container.textContent, /No coverage runs/);
});

test('newer date-range results cannot be overwritten by a slower earlier response', async () => {
  let calls = 0;
  let finish: (value: unknown) => void = () => {};
  const s = screen({
    query: async () => {
      calls++;
      if (calls === 1)
        return await new Promise((resolve) => {
          finish = resolve;
        });
      return { totalRuns: 0, aggregated: false, points: [] };
    },
  });
  try {
    await setImmediate();
    (s.node('history-from') as HTMLInputElement).value = '2026-10-01';
    (s.node('history-through') as HTMLInputElement).value = '2026-10-02';
    s.node('history-form').dispatchEvent(
      new s.window.Event('submit', { cancelable: true }),
    );
    await setImmediate();
    finish({
      totalRuns: 1,
      aggregated: false,
      points: [
        {
          at: '2026-10-26T12:00:00.000Z',
          percentage: 99,
          minimum: 99,
          maximum: 99,
          count: 1,
          runId: 'old',
        },
      ],
    });
    await setImmediate();
    assert.match(s.node('history-chart').textContent, /No coverage runs/);
    assert.match(s.node('history-range-label').textContent, /2026-10-01/);
  } finally {
    s.dispose();
  }
});

test('hover/focus shows a visible date/percentage tooltip and pointer exit hides it', () => {
  const { document, window } = parseHTML('<div id="chart"></div>');
  const container = document.getElementById('chart')!;
  drawHistory(
    document as unknown as Document,
    container as unknown as HTMLElement,
    {
      totalRuns: 1,
      aggregated: false,
      points: [
        {
          at: '2026-10-26T12:00:00.000Z',
          percentage: 80,
          minimum: 80,
          maximum: 80,
          count: 1,
          runId: 'run-1',
        },
      ],
    },
  );
  const point = container.querySelector('circle')!;
  const tooltip = container.querySelector('[role="tooltip"]')!;
  point.dispatchEvent(new window.Event('pointerover', { bubbles: true }));
  assert.equal(tooltip.hasAttribute('hidden'), false);
  assert.match(tooltip.textContent, /Date:/);
  assert.match(tooltip.textContent, /2026/);
  assert.match(tooltip.textContent, /Coverage: 80.00%/);
  point.dispatchEvent(new window.Event('pointerout', { bubbles: true }));
  assert.equal(tooltip.hasAttribute('hidden'), true);
  point.dispatchEvent(new window.Event('focusin', { bubbles: true }));
  assert.equal(tooltip.hasAttribute('hidden'), false);
});

test('history data headers sort numeric percentages without reordering the graph', async () => {
  const s = screen({
    query: async () => ({
      totalRuns: 2,
      aggregated: false,
      points: [80, 9].map((value, i) => ({
        at: `2026-10-${25 + i}T12:00:00.000Z`,
        percentage: value,
        minimum: value,
        maximum: value,
        count: 1,
        runId: `run-${i}`,
      })),
    }),
  });
  try {
    await setImmediate();
    const button = s
      .node('history-data')
      .closest('table')!
      .querySelectorAll('thead button')[1]!;
    button.dispatchEvent(new s.window.Event('click'));
    assert.match(
      s.node('history-data').firstElementChild!.textContent,
      /9.00%/,
    );
    button.dispatchEvent(new s.window.Event('click'));
    assert.match(
      s.node('history-data').firstElementChild!.textContent,
      /80.00%/,
    );
    assert.equal(s.node('history-chart').querySelectorAll('circle').length, 2);
  } finally {
    s.dispose();
  }
});
