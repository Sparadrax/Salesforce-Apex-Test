import { app, BrowserWindow, dialog } from 'electron';
import path from 'node:path';
import started from 'electron-squirrel-startup';
import { createMainWindow } from './windows/main-window';
import { DatabaseClient } from './database/client';
import { registerDatabaseIpc } from './database/ipc';
import { registerOrgsIpc } from './features/orgs/ipc';
import { WindowRegistry } from './windows/window-registry';
import type { WindowContext } from '../shared/contracts/orgs';
import { registerCoverageHistoryIpc } from './features/coverage-history/ipc';

let database: DatabaseClient | undefined;
let mainWindow: BrowserWindow | null = null;
let shutdownComplete = false;
const windows = new WindowRegistry();

function createWindow(context: WindowContext): BrowserWindow {
  const window = createMainWindow();
  windows.register(window, context, (id) => {
    void database?.releaseOrgSession(String(id)).catch(() => {});
  });
  return window;
}

function openWindow(): void {
  mainWindow = createWindow({ view: 'orgs' });
  mainWindow.once('closed', () => {
    mainWindow = null;
  });
}

if (started || !app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow?.isMinimized()) mainWindow.restore();
    if (mainWindow) mainWindow.focus();
    else openWindow();
  });
  void app
    .whenReady()
    .then(async () => {
      database = new DatabaseClient(
        path.join(app.getPath('userData'), 'data', 'application.sqlite'),
        path.join(__dirname, 'database-worker.cjs'),
      );
      await database.status();
      registerDatabaseIpc(database, (id) => windows.resolve(id));
      registerOrgsIpc(database, windows, (orgId) => {
        createWindow({ view: 'org', orgId });
      });
      registerCoverageHistoryIpc(database, windows, (orgId, apexClass) => {
        createWindow({ view: 'class-history', orgId, apexClass });
      });
      openWindow();
      app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) openWindow();
      });
    })
    .catch((error: unknown) => {
      console.error('Application initialization failed:', error);
      dialog.showErrorBox(
        'Unable to open local database',
        'The local database could not be opened. Check available disk space and permissions. Existing data has not been reset.',
      );
      app.quit();
    });
}

app.on('before-quit', (event) => {
  if (!database || shutdownComplete) return;
  event.preventDefault();
  void database
    .close()
    .catch((error: unknown) =>
      console.error('Database shutdown failed:', error),
    )
    .finally(() => {
      shutdownComplete = true;
      app.quit();
    });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
