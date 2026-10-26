import assert from 'node:assert/strict';
import { test } from 'node:test';
import { setImmediate } from 'node:timers/promises';
import { parseHTML } from 'linkedom';
import { ScrollTable } from '../src/renderer/shared/scroll-table';

function fixture(
  fetch: (
    cursor: string,
  ) => Promise<{ rows: string[]; nextCursor: string | null }>,
) {
  const { document, window } = parseHTML(
    '<section><div class="table-scroll"><table><tbody></tbody></table></div><p></p></section>',
  );
  const body = document.querySelector('tbody')!;
  const viewport = document.querySelector('.table-scroll')!;
  Object.defineProperty(viewport, 'clientHeight', { value: 100 });
  Object.defineProperty(viewport, 'scrollHeight', { value: 1000 });
  const errors: unknown[] = [];
  const table = new ScrollTable<string>({
    panel: document.querySelector('section')! as unknown as HTMLElement,
    body: body as unknown as HTMLElement,
    empty: document.querySelector('p')! as unknown as HTMLElement,
    fetch,
    render: (value) => {
      const row = document.createElement('tr');
      row.textContent = value;
      return row as unknown as HTMLTableRowElement;
    },
    error: (error) => errors.push(error),
  });
  function scroll() {
    (viewport as HTMLElement).scrollTop = 900;
    viewport.dispatchEvent(new window.Event('scroll'));
  }
  return { table, body, errors, scroll };
}

test('scroll loads subsequent cursor batches and preserves the existing rows and selection', async () => {
  const requested: string[] = [];
  const f = fixture(async (cursor) => {
    requested.push(cursor);
    return cursor
      ? { rows: ['third'], nextCursor: null }
      : { rows: ['first', 'second'], nextCursor: 'second' };
  });
  try {
    f.table.reset('');
    await f.table.load();
    const selected = f.body.firstElementChild!;
    selected.classList.add('selected');
    f.scroll();
    await setImmediate();
    assert.deepEqual(requested, ['', 'second']);
    assert.equal(f.body.children.length, 3);
    assert.equal(f.body.firstElementChild, selected);
    assert.equal(selected.classList.contains('selected'), true);
    f.scroll();
    await setImmediate();
    assert.equal(requested.length, 2);
  } finally {
    f.table.dispose();
  }
});

test('changing the parent invalidates a pending scroll response without resetting the newer table', async () => {
  let resolveOld: (value: {
    rows: string[];
    nextCursor: string | null;
  }) => void = () => {};
  let scope = 'old';
  const f = fixture(async () =>
    scope === 'old'
      ? await new Promise((resolve) => {
          resolveOld = resolve;
        })
      : { rows: ['new row'], nextCursor: null },
  );
  try {
    f.table.reset('');
    const old = f.table.load();
    scope = 'new';
    f.table.reset('');
    await f.table.load();
    resolveOld({ rows: ['old row'], nextCursor: 'old' });
    await old;
    assert.equal(f.body.textContent, 'new row');
    assert.equal(f.errors.length, 0);
  } finally {
    f.table.dispose();
  }
});
