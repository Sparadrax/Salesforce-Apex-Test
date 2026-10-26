import type { BrowserWindow } from 'electron';
import type { WindowContext } from '../../shared/contracts/orgs';

/** Identity comes from main-process registration, never from a URL or renderer parameter. */
export class WindowRegistry {
  private readonly entries = new Map<
    number,
    { window: BrowserWindow; context: WindowContext }
  >();
  register(
    window: BrowserWindow,
    context: WindowContext,
    onClose: (id: number) => void,
  ): void {
    const id = window.webContents.id;
    this.entries.set(id, { window, context });
    window.once('closed', () => {
      this.entries.delete(id);
      onClose(id);
    });
  }
  resolve(id: number): BrowserWindow | null {
    const entry = this.entries.get(id);
    return entry && !entry.window.isDestroyed() ? entry.window : null;
  }
  context(id: number): WindowContext {
    const entry = this.entries.get(id);
    if (!entry || entry.window.isDestroyed())
      throw new Error('This application window has closed.');
    return entry.context;
  }
  closeOrg(orgId: string): void {
    for (const { window, context } of this.entries.values()) {
      if (
        context.view !== 'orgs' &&
        context.orgId === orgId &&
        !window.isDestroyed()
      )
        window.close();
    }
  }
  notify(orgId: string, exceptId?: number): void {
    for (const [id, { window, context }] of this.entries) {
      if (
        id !== exceptId &&
        !window.isDestroyed() &&
        (context.view === 'orgs' || context.orgId === orgId)
      )
        window.webContents.send('orgs:changed', orgId);
    }
  }
}
