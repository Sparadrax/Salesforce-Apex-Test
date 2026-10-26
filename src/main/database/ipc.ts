import { ipcMain, type IpcMainInvokeEvent } from 'electron';
import type { BrowserWindow } from 'electron';
import type { DatabaseClient } from './client';
import { authorizeAppSender } from '../security/authorize-sender';

export function registerDatabaseIpc(
  database: DatabaseClient,
  getWindow: (webContentsId: number) => BrowserWindow | null,
): void {
  function authorize(event: IpcMainInvokeEvent): void {
    authorizeAppSender(event, getWindow);
  }

  ipcMain.handle('database:status', (event) => {
    authorize(event);
    return database.status();
  });
  ipcMain.handle(
    'database:put-batch',
    (event, collection: unknown, records: unknown) => {
      authorize(event);
      return database.putBatch(collection, records);
    },
  );
  ipcMain.handle('database:list', (event, request: unknown) => {
    authorize(event);
    return database.list(request);
  });
  ipcMain.handle(
    'database:delete',
    (event, collection: unknown, key: unknown) => {
      authorize(event);
      return database.delete(collection, key);
    },
  );
  ipcMain.handle('database:get', (event, collection: unknown, key: unknown) => {
    authorize(event);
    return database.get(collection, key);
  });
}
