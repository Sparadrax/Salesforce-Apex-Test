import type {
  OrgRunsApi,
  OrgSummary,
  DeploymentPreview,
  ImportConfirmation,
  ImportReceipt,
} from '../../../shared/contracts/orgs';
import { element, message } from '../../shared/dom';

export function mountRunImporter(
  root: Document,
  api: Pick<OrgRunsApi, 'chooseImport' | 'discardImport'> & {
    confirmImport(
      token: string,
      identity?: Omit<ImportConfirmation, 'token'>,
    ): Promise<ImportReceipt>;
  },
  getOrg: () => OrgSummary | null,
  onImported: () => Promise<void>,
  fromList = false,
): () => void {
  const node = <T extends HTMLElement>(id: string) => element<T>(root, id);
  const dialog = node<HTMLDialogElement>('import-dialog');
  const form = node<HTMLFormElement>('import-form');
  const confirm = node<HTMLButtonElement>('confirm-import');
  const button = node<HTMLButtonElement>(
    fromList ? 'org-import-button' : 'import-button',
  );
  const emptyButton = node<HTMLButtonElement>(
    fromList ? 'empty-org-import-button' : 'empty-import-button',
  );
  const orgIdInput = node<HTMLInputElement>('import-org-id');
  const hostInput = node<HTMLInputElement>('import-org-hostname');
  node('import-identity').hidden = !fromList;
  orgIdInput.disabled = hostInput.disabled = !fromList;
  const abort = new AbortController();
  const options = { signal: abort.signal };
  let preview: DeploymentPreview | null = null;
  let busy = false;
  let saving = false;
  let disposed = false;
  function showError(cause: unknown): void {
    const notice = node(fromList ? 'notice' : 'run-notice');
    notice.hidden = false;
    notice.textContent = message(cause);
    notice.classList.add('error');
  }
  async function choose(): Promise<void> {
    if (busy || preview || (!fromList && !getOrg())) return;
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
      node('import-target').textContent = fromList
        ? 'Import into the organization below. It will be created if it does not exist.'
        : `${getOrg()!.hostName ?? getOrg()!.id} · ${getOrg()!.id}`;
      orgIdInput.value = selected.orgId ?? '';
      orgIdInput.readOnly = selected.orgId !== null;
      hostInput.value = selected.hostName ?? '';
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
      if (!preview || saving || !form.reportValidity()) return;
      saving = true;
      confirm.disabled = true;
      confirm.textContent = 'Importing…';
      node('import-error').hidden = true;
      void api
        .confirmImport(
          preview.token,
          fromList
            ? { orgId: orgIdInput.value, hostName: hostInput.value }
            : undefined,
        )
        .then(async () => {
          preview = null;
          if (disposed) return;
          dialog.close();
          node(fromList ? 'notice' : 'run-notice').hidden = true;
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
