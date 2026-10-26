import type { BrowserWindow, IpcMainInvokeEvent } from 'electron';

export function authorizeAppSender(
  event: IpcMainInvokeEvent,
  getWindow: (webContentsId: number) => BrowserWindow | null,
): BrowserWindow {
  const window = getWindow(event.sender.id);
  if (
    !window ||
    event.sender !== window.webContents ||
    event.senderFrame !== window.webContents.mainFrame
  )
    throw new Error('Unauthorized database request');
  const url = new URL(event.senderFrame.url);
  if (MAIN_WINDOW_VITE_DEV_SERVER_URL) {
    if (url.origin !== new URL(MAIN_WINDOW_VITE_DEV_SERVER_URL).origin)
      throw new Error('Untrusted database origin');
  } else if (
    url.protocol !== 'file:' ||
    !url.pathname.endsWith(`/renderer/${MAIN_WINDOW_VITE_NAME}/index.html`)
  ) {
    throw new Error('Untrusted database origin');
  }
  return window;
}
