import type {
  OrgRunsApi,
  OrgSummary,
  DeploymentPreview,
} from '../../../shared/contracts/orgs';
import { element, message } from '../../shared/dom';

export function mountRunImporter(
  root: Document,
  api: OrgRunsApi,
  getOrg: () => OrgSummary | null,
  onImported: () => Promise<void>,
): () => void {
  const node = <T extends HTMLElement>(id: string) => element<T>(root, id);
  const dialog = node<HTMLDialogElement>('import-dialog');
  const form = node<HTMLFormElement>('import-form');
  const confirm = node<HTMLButtonElement>('confirm-import');
  const button = node<HTMLButtonElement>('import-button');
  const emptyButton = node<HTMLButtonElement>('empty-import-button');
  const abort = new AbortController();
  const options = { signal: abort.signal };
  let preview: DeploymentPreview | null = null;
  let busy = false;
  let saving = false;
  let disposed = false;
  function showError(cause: unknown): void {
    node('run-notice').hidden = false;
    node('run-notice').textContent = message(cause);
    node('run-notice').classList.add('error');
  }
  async function choose(): Promise<void> {
    if (busy || preview || !getOrg()) return;
    busy = true;
    button.disabled = emptyButton.disabled = true;
    button.textContent = 'Reading JSON…';
    try {
      const selected = await api.chooseImport();
      if (!selected) return;
      if (disposed) {
        await api.discardImport(selected.token);
        return;
      }
      preview = selected;
      node('import-file').textContent = selected.sourceName;
      node('import-run').textContent = `Run ${selected.runId}`;
      node('import-target').textContent =
        `${getOrg()!.hostName ?? getOrg()!.id} · ${getOrg()!.id}`;
      node('import-class-count').textContent = String(selected.classCount);
      node('import-test-count').textContent = String(selected.testsRun);
      node('import-failures').textContent = String(selected.failures);
      node('import-status').textContent = selected.status;
      node('import-error').hidden = true;
      dialog.showModal();
      confirm.focus();
    } catch (cause) {
      if (!disposed) showError(cause);
    } finally {
      busy = false;
      if (!disposed) {
        button.disabled = emptyButton.disabled = false;
        button.textContent = '＋ Import JSON';
      }
    }
  }
  function dismiss(): void {
    if (saving) return;
    const staged = preview;
    preview = null;
    dialog.close();
    if (staged) void api.discardImport(staged.token).catch(() => {});
    button.focus();
  }
  button.addEventListener(
    'click',
    () => {
      void choose();
    },
    options,
  );
  emptyButton.addEventListener(
    'click',
    () => {
      void choose();
    },
    options,
  );
  node('cancel-import').addEventListener('click', dismiss, options);
  node('close-import').addEventListener('click', dismiss, options);
  dialog.addEventListener(
    'cancel',
    (event) => {
      event.preventDefault();
      dismiss();
    },
    options,
  );
  form.addEventListener(
    'submit',
    (event) => {
      event.preventDefault();
      if (!preview || saving) return;
      saving = true;
      confirm.disabled = true;
      confirm.textContent = 'Importing…';
      node('import-error').hidden = true;
      void api
        .confirmImport(preview.token)
        .then(async () => {
          preview = null;
          if (disposed) return;
          dialog.close();
          node('run-notice').hidden = true;
          await onImported();
          button.focus();
        })
        .catch((cause: unknown) => {
          if (!disposed) {
            node('import-error').textContent = message(cause);
            node('import-error').hidden = false;
          }
        })
        .finally(() => {
          saving = false;
          confirm.disabled = false;
          confirm.textContent = 'Import results';
        });
    },
    options,
  );
  return () => {
    disposed = true;
    abort.abort();
    if (preview && !saving)
      void api.discardImport(preview.token).catch(() => {});
  };
}
