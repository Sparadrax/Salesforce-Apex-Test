// Validate the packaged coverage UI against an isolated snapshot, never the live DB.
const { app } = require('electron');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const directory = process.env.APEX_SMOKE_USER_DATA;
if (!directory)
  throw new Error(
    'Run with node scripts/run-electron-smoke.cjs coverage so cleanup happens after exit.',
  );
fs.mkdirSync(path.join(directory, 'data'));
fs.copyFileSync(
  path.resolve(process.argv[3]),
  path.join(directory, 'data/application.sqlite'),
);
app.setPath('userData', directory);
let passed = false;
const timeout = setTimeout(() => {
  console.error('Coverage UI check timed out');
  app.exit(1);
}, 30000);
async function until(window, expression) {
  const deadline = Date.now() + 10000;
  while (Date.now() < deadline) {
    if (await window.webContents.executeJavaScript(expression)) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error('UI condition timed out: ' + expression);
}
app.once('browser-window-created', (_event, root) => {
  root.webContents.once('did-finish-load', async () => {
    try {
      const popupReady = new Promise((resolve) =>
        app.once('browser-window-created', (_event, popup) =>
          popup.webContents.once('did-finish-load', () => resolve(popup)),
        ),
      );
      await root.webContents.executeJavaScript(
        "window.desktop.orgs.open('00D000000000001EAA')",
      );
      const popup = await popupReady;
      await until(
        popup,
        "document.querySelectorAll('#classes-body tr').length === 50",
      );
      await popup.webContents.executeJavaScript(
        "document.querySelector('#classes-body button').click()",
      );
      await until(
        popup,
        "document.querySelectorAll('#test-classes-body tr').length === 2",
      );
      await popup.webContents.executeJavaScript(
        "document.querySelector('#test-classes-body button').click()",
      );
      await until(
        popup,
        "document.querySelectorAll('#methods-body tr').length >= 4",
      );
      const result = await popup.webContents.executeJavaScript(`(async () => ({
        schema: (await window.desktop.database.status()).schemaVersion,
        apexClasses: document.querySelectorAll('#classes-body tr').length,
        testClasses: document.querySelectorAll('#test-classes-body tr').length,
        methods: document.querySelectorAll('#methods-body tr').length,
        methodCells: [...document.querySelectorAll('#methods-body tr')].map(row => [...row.querySelectorAll('td')].map(cell => cell.textContent))
      }))()`);
      assert.equal(result.schema, 6);
      assert.equal(result.apexClasses, 50);
      assert.equal(result.testClasses, 2);
      assert.ok(result.methods >= 4 && result.methods <= 6);
      assert.ok(
        result.methodCells.every(
          (cells) =>
            cells[2].endsWith('%') && ['Passed', 'Failed'].includes(cells[1]),
        ),
      );
      const historyReady = new Promise((resolve) =>
        app.once('browser-window-created', (_event, history) =>
          history.webContents.once('did-finish-load', () => resolve(history)),
        ),
      );
      popup.focus();
      popup.webContents.focus();
      const position = await popup.webContents.executeJavaScript(`(() => {
        const box = document.querySelector('#classes-body button').getBoundingClientRect();
        return { x: Math.round(box.left + Math.min(20, box.width / 2)), y: Math.round(box.top + box.height / 2) };
      })()`);
      popup.webContents.sendInputEvent({ type: 'mouseMove', ...position });
      popup.webContents.sendInputEvent({
        type: 'mouseDown',
        button: 'right',
        clickCount: 1,
        ...position,
      });
      popup.webContents.sendInputEvent({
        type: 'mouseUp',
        button: 'right',
        clickCount: 1,
        ...position,
      });
      const history = await historyReady;
      await until(
        history,
        "document.querySelector('#history-chart circle') !== null",
      );
      const graph = await history.webContents.executeJavaScript(`({
        className: document.querySelector('#history-class').textContent,
        points: document.querySelectorAll('#history-chart circle').length,
        from: document.querySelector('#history-from').value,
        through: document.querySelector('#history-through').value
      })`);
      assert.ok(graph.className);
      assert.ok(graph.points > 0);
      assert.ok(graph.from && graph.through);
      history.focus();
      history.webContents.focus();
      const pointPosition = await history.webContents
        .executeJavaScript(`(() => {
        const box = document.querySelector('#history-chart circle').getBoundingClientRect();
        return { x: Math.round(box.left + box.width / 2), y: Math.round(box.top + box.height / 2) };
      })()`);
      history.webContents.sendInputEvent({
        type: 'mouseMove',
        ...pointPosition,
      });
      await until(
        history,
        "document.querySelector('[role=tooltip]')?.hidden === false",
      );
      const tooltipText = await history.webContents.executeJavaScript(
        "document.querySelector('[role=tooltip]').textContent",
      );
      assert.match(tooltipText, /Date:/);
      assert.match(tooltipText, /Coverage:.*%/);
      await history.webContents.executeJavaScript(`(() => {
        document.querySelector('#history-from').value = '2000-01-01';
        document.querySelector('#history-through').value = '2000-01-02';
        document.querySelector('#history-form').requestSubmit();
      })()`);
      await until(
        history,
        "document.querySelector('#history-chart').textContent.includes('No coverage runs')",
      );
      console.log(
        'PASS: native right-click opens coverage graph and date range filters its data',
        JSON.stringify(graph),
      );
      console.log(
        'PASS: packaged recovery and native UI drill-down',
        JSON.stringify(result),
      );
      passed = true;
    } catch (error) {
      console.error(error);
    } finally {
      clearTimeout(timeout);
      app.quit();
    }
  });
});
app.on('will-quit', () => {
  if (!passed) process.exitCode = 1;
});
require(path.resolve(process.argv[2]));
