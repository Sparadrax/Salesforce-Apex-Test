import { dialog, ipcMain, type IpcMainInvokeEvent } from 'electron';
import type { DatabaseClient } from '../../database/client';
import type { RunCursor } from '../../../shared/contracts/orgs';
import type { TableSort } from '../../../shared/contracts/table-sort';
import { authorizeAppSender } from '../../security/authorize-sender';
import type { WindowRegistry } from '../../windows/window-registry';

export function registerOrgsIpc(
  database: DatabaseClient,
  windows: WindowRegistry,
  openOrg: (id: string) => void,
): void {
  const choosing = new Set<number>();
  const authorize = (event: IpcMainInvokeEvent) =>
    authorizeAppSender(event, (id) => windows.resolve(id));
  const listWindow = (event: IpcMainInvokeEvent) => {
    const window = authorize(event);
    if (windows.context(window.webContents.id).view !== 'orgs')
      throw new Error('Use the organization list for this action.');
    return window;
  };
  const orgWindow = (event: IpcMainInvokeEvent) => {
    const window = authorize(event);
    const context = windows.context(window.webContents.id);
    if (context.view !== 'org')
      throw new Error('Open an organization to view or import test results.');
    return {
      window,
      orgId: context.orgId,
      session: String(window.webContents.id),
    };
  };
  ipcMain.handle('workspace:context', (event) => {
    authorize(event);
    return windows.context(event.sender.id);
  });
  ipcMain.handle('orgs:list', (event, afterId: unknown, sort?: TableSort) => {
    listWindow(event);
    return database.listOrgs(afterId, sort);
  });
  ipcMain.handle('orgs:add', async (event, value: unknown) => {
    listWindow(event);
    const org = await database.addOrg(value);
    windows.notify(org.id, event.sender.id);
    return org;
  });
  ipcMain.handle('orgs:delete', async (event, id: unknown) => {
    const window = listWindow(event);
    const org = await database.getOrg(id);
    const answer = await dialog.showMessageBox(window, {
      type: 'warning',
      buttons: ['Cancel', 'Delete organization'],
      defaultId: 0,
      cancelId: 0,
      title: 'Delete organization',
      message: `Delete ${org.hostName ?? org.id}?`,
      detail: `This permanently deletes ${org.runCount} saved run(s), all test results, coverage, and imported JSON for ${org.id}. Its open windows will close. This cannot be undone.`,
      noLink: true,
    });
    if (answer.response !== 1) return false;
    listWindow(event);
    const removed = await database.deleteOrg(org.id);
    windows.closeOrg(org.id);
    windows.notify(org.id, event.sender.id);
    return removed;
  });
  ipcMain.handle('orgs:open', async (event, id: unknown) => {
    listWindow(event);
    const org = await database.getOrg(id);
    listWindow(event);
    openOrg(org.id); // Every request creates a fresh, unparented window, including for the same org.
  });
  ipcMain.handle('runs:current', (event) =>
    database.getOrg(orgWindow(event).orgId),
  );
  ipcMain.handle(
    'runs:covering-tests',
    (
      event,
      runId: string,
      apexClass: string,
      afterId?: string,
      sort?: TableSort,
    ) =>
      database.coveringTests(
        orgWindow(event).orgId,
        runId,
        apexClass,
        afterId,
        sort,
      ),
  );
  ipcMain.handle(
    'runs:methods',
    (
      event,
      runId: string,
      apexClass: string,
      testClass: string,
      afterName?: string,
      sort?: TableSort,
    ) =>
      database.coveredMethods(
        orgWindow(event).orgId,
        runId,
        apexClass,
        testClass,
        afterName,
        sort,
      ),
  );
  ipcMain.handle('runs:list', (event, cursor?: RunCursor) =>
    database.orgRuns(orgWindow(event).orgId, cursor),
  );
  ipcMain.handle('runs:tests', (event, runId: string, afterIndex?: number) =>
    database.orgTests(orgWindow(event).orgId, runId, afterIndex),
  );
  ipcMain.handle(
    'runs:coverage',
    (event, runId: string, afterId?: string, sort?: TableSort) =>
      database.orgCoverage(orgWindow(event).orgId, runId, afterId, sort),
  );
  ipcMain.handle('orgs:choose-import', async (event) => {
    const { window, orgId, session } = orgWindow(event);
    const id = window.webContents.id;
    if (choosing.has(id))
      throw new Error(
        'An import file is already being selected in this window.',
      );
    choosing.add(id);
    try {
      const selection = await dialog.showOpenDialog(window, {
        title: 'Import Salesforce deployment test results',
        filters: [
          { name: 'Salesforce deployment results', extensions: ['json'] },
        ],
        properties: ['openFile'],
      });
      if (selection.canceled || !selection.filePaths[0]) return null;
      orgWindow(event);
      const preview = await database.prepareOrgImport(
        selection.filePaths[0],
        session,
        orgId,
      );
      if (window.isDestroyed()) {
        await database.releaseOrgSession(session);
        return null;
      }
      return preview;
    } finally {
      choosing.delete(id);
    }
  });
  ipcMain.handle('orgs:confirm-import', async (event, token: unknown) => {
    const { orgId, session } = orgWindow(event);
    const org = await database.getOrg(orgId);
    const receipt = await database.commitOrgImport(
      { token, orgId: org.id, hostName: org.hostName },
      session,
    );
    windows.notify(orgId, event.sender.id);
    return receipt;
  });
  ipcMain.handle('orgs:discard-import', (event, token: unknown) =>
    database.discardOrgImport(token, orgWindow(event).session),
  );
}
