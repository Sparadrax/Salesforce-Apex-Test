// Exercises the production bundle through Electron and its actual preload/IPC path.
const { app, BrowserWindow } = require('electron');
const assert = require('node:assert/strict');
const { existsSync } = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

const directory = process.env.APEX_SMOKE_USER_DATA;
if (!directory)
  throw new Error(
    'Run with node scripts/run-electron-smoke.cjs database so cleanup happens after exit.',
  );
app.setPath('userData', directory);
const timer = setTimeout(() => {
  console.error('Electron database smoke test timed out');
  app.exit(1);
}, 30000);
let passed = false;
const entry = path.resolve(process.argv[2] || '.vite/build/main.cjs');

app.once('browser-window-created', (_event, window) => {
  window.webContents.once('did-finish-load', async () => {
    try {
      const result = await window.webContents.executeJavaScript(`(async () => {
        const db = window.desktop.database;
        const status = await db.status();
        const inserted = await db.putBatch('smoke', [{ key: 'first', json: '{"passed":true}' }]);
        const page = await db.list({ collection: 'smoke' });
        const found = await db.get('smoke', 'first');
        const queued = await Promise.allSettled(Array.from({ length: 20 }, () => db.status()));
        let rejected = false;
        try { await db.list({ collection: 'smoke', limit: 1000000 }); } catch { rejected = true; }
        const deleted = await db.delete('smoke', 'first');
        const empty = await db.list({ collection: 'smoke' });
        return { status, inserted, page, found, deleted, remaining: empty.records.length, rejected, queueRejected: queued.filter(item => item.status === 'rejected').length, nodeDisabled: typeof require === 'undefined' };
      })()`);
      assert.equal(result.status.engine, 'sqlite');
      assert.equal(result.status.schemaVersion, 6);
      assert.equal(result.status.journalMode, 'wal');
      assert.equal(result.inserted, 1);
      assert.equal(result.page.records[0].json, '{"passed":true}');
      assert.equal(result.found.key, 'first');
      assert.ok(result.queueRejected > 0);
      assert.equal(result.deleted, true);
      assert.equal(result.remaining, 0);
      assert.equal(result.rejected, true);
      assert.equal(result.nodeDisabled, true);
      assert.equal(
        existsSync(path.join(directory, 'data', 'application.sqlite')),
        true,
      );
      const inspector = new DatabaseSync(
        path.join(directory, 'data', 'application.sqlite'),
        { readOnly: true },
      );
      try {
        for (const name of [
          'Org',
          'Run',
          'ApexClass',
          'ApexTestClass',
          'TestClassCoverage',
          'GlobalCoverage',
          'TestMethodCoverage',
          'DeploymentImport',
          'RunReport',
          'RunTestResult',
        ]) {
          assert.ok(
            inspector
              .prepare(
                "SELECT name FROM sqlite_schema WHERE type = 'table' AND name = ?",
              )
              .get(name),
          );
        }
      } finally {
        inspector.close();
      }
      const untrusted = new BrowserWindow({
        show: false,
        webPreferences: {
          preload: path.join(path.dirname(entry), 'preload.cjs'),
          contextIsolation: true,
          nodeIntegration: false,
          sandbox: true,
        },
      });
      try {
        await untrusted.loadFile(
          path.join(path.dirname(entry), '../renderer/main_window/index.html'),
        );
        await assert.rejects(
          untrusted.webContents.executeJavaScript(
            'window.desktop.database.status()',
          ),
          /Unauthorized/,
        );
      } finally {
        untrusted.destroy();
      }
      console.log(
        'PASS: Electron worker, SQLite, preload API, validated IPC, CRUD and shutdown',
      );
      passed = true;
    } catch (error) {
      console.error(error);
    } finally {
      clearTimeout(timer);
      app.quit();
    }
  });
});

app.on('will-quit', () => {
  if (!passed) process.exitCode = 1;
});

// Optional argument tests the packaged ASAR instead of the unpackaged bundle.
require(entry);
