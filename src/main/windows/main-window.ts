import { BrowserWindow } from 'electron';
import path from 'node:path';

export function createMainWindow(): BrowserWindow {
  const window = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    title: 'Salesforce Apex Test',
    backgroundColor: '#0b1220',
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  window.once('ready-to-show', () => window.show());
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', (event) => event.preventDefault());

  const loading = MAIN_WINDOW_VITE_DEV_SERVER_URL
    ? window.loadURL(MAIN_WINDOW_VITE_DEV_SERVER_URL)
    : window.loadFile(
        path.join(__dirname, `../renderer/${MAIN_WINDOW_VITE_NAME}/index.html`),
      );
  void loading.catch((error: unknown) => {
    console.error('Unable to load the application window:', error);
    window.destroy();
  });

  return window;
}
