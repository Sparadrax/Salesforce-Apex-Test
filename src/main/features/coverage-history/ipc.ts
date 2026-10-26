import { ipcMain } from 'electron';
import type { DatabaseClient } from '../../database/client';
import type { WindowRegistry } from '../../windows/window-registry';
import { authorizeAppSender } from '../../security/authorize-sender';

export function registerCoverageHistoryIpc(
  database: DatabaseClient,
  windows: WindowRegistry,
  open: (orgId: string, apexClass: string) => void,
): void {
  ipcMain.handle('runs:open-history', async (event, apexClass: unknown) => {
    authorizeAppSender(event, (id) => windows.resolve(id));
    const context = windows.context(event.sender.id);
    if (context.view !== 'org')
      throw new Error('Open an organization to view class history.');
    const identity = await database.classHistoryIdentity(
      context.orgId,
      apexClass,
    );
    authorizeAppSender(event, (id) => windows.resolve(id));
    open(identity.orgId, identity.classId);
  });
  ipcMain.handle('history:current', (event) => {
    authorizeAppSender(event, (id) => windows.resolve(id));
    const context = windows.context(event.sender.id);
    if (context.view !== 'class-history')
      throw new Error('Use a coverage-history window for this action.');
    return database.classHistoryIdentity(context.orgId, context.apexClass);
  });
  ipcMain.handle('history:query', (event, range: unknown) => {
    authorizeAppSender(event, (id) => windows.resolve(id));
    const context = windows.context(event.sender.id);
    if (context.view !== 'class-history')
      throw new Error('Use a coverage-history window for this action.');
    return database.classHistory(context.orgId, context.apexClass, range);
  });
}
