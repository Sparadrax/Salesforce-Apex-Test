import './styles/global.css';
import { mountOrgs } from './features/orgs/orgs';
import { mountRuns } from './features/runs/runs';

let disposed = false;
let dispose: (() => void) | undefined;
void window.desktop
  .context()
  .then(async (context) => {
    if (disposed) return;
    if (context.view === 'class-history') {
      const [{ mountHistory }] = await Promise.all([
        import('./features/history/history'),
        import('./features/history/history.css'),
      ]);
      if (!disposed) dispose = mountHistory(document, window.desktop.history);
      return;
    }
    dispose =
      context.view === 'orgs'
        ? mountOrgs(document, window.desktop.orgs)
        : mountRuns(document, window.desktop.runs);
  })
  .catch(() => {
    const message = document.getElementById('startup-error');
    if (message) {
      message.hidden = false;
      message.textContent =
        'Unable to open this workspace. Close the window and try again.';
    }
  });
if (import.meta.hot)
  import.meta.hot.dispose(() => {
    disposed = true;
    dispose?.();
  });
