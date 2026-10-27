import type { OrgsApi, OrgSummary } from '../../../shared/contracts/orgs';
import { element, message } from '../../shared/dom';
import { ScrollTable } from '../../shared/scroll-table';
import { mountRunImporter } from '../runs/import-dialog';

export function mountOrgs(root: Document, api: OrgsApi): () => void {
  const node = <T extends HTMLElement>(id: string) => element<T>(root, id);
  node('org-screen').hidden = false;
  const list = node('org-list');
  const dialog = node<HTMLDialogElement>('add-org-dialog');
  const form = node<HTMLFormElement>('add-org-form');
  const add = node<HTMLButtonElement>('save-org');
  const idInput = node<HTMLInputElement>('add-org-id');
  const hostInput = node<HTMLInputElement>('add-org-hostname');
  const notice = node('notice');
  const abort = new AbortController();
  const options = { signal: abort.signal };
  let disposed = false;
  let sequence = 0;
  let saving = false;
  function error(cause: unknown): void {
    notice.textContent = message(cause);
    notice.hidden = false;
    notice.classList.add('error');
    notice.setAttribute('role', 'alert');
  }
  function renderOrg(org: OrgSummary): HTMLTableRowElement {
    const row = root.createElement('tr');
    const td = root.createElement('td');
    const open = root.createElement('button');
    open.type = 'button';
    open.className = 'org-open';
    open.dataset.orgId = org.id;
    const name = root.createElement('span');
    name.className = 'org-name';
    name.textContent = org.hostName ?? 'Unnamed organization';
    const id = root.createElement('span');
    id.className = 'org-id';
    id.textContent = org.id;
    open.append(name, id);
    td.append(open);
    const action = root.createElement('td');
    action.className = 'org-actions';
    const button = root.createElement('button');
    button.type = 'button';
    button.className = 'button subtle';
    button.dataset.orgId = org.id;
    button.textContent = 'Open tests ↗';
    const remove = root.createElement('button');
    remove.type = 'button';
    remove.className = 'button subtle danger-text';
    remove.dataset.deleteOrgId = org.id;
    remove.textContent = 'Delete';
    remove.setAttribute('aria-label', `Delete ${org.hostName ?? org.id}`);
    action.append(button, remove);
    row.append(td, action);
    return row;
  }
  const table = new ScrollTable<OrgSummary>({
    panel: node('org-panel'),
    body: list,
    empty: node('org-scroll-empty'),
    sorting: {
      columns: ['hostName', null],
      initial: { column: 'hostName', direction: 'asc' },
    },
    fetch: async (after, sort) => {
      const page = await api.list(after, sort);
      return { rows: page.orgs, nextCursor: page.nextCursor };
    },
    render: renderOrg,
    error,
    changed: (count) => {
      node('org-count').textContent = String(count);
      node('org-table-container').hidden = count === 0;
      node('empty-state').hidden = count !== 0;
      node('org-scroll-empty').hidden = true;
    },
  });
  async function load(): Promise<void> {
    const version = ++sequence;
    table.reset('');
    node('loading').hidden = false;
    node('empty-state').hidden = true;
    node<HTMLButtonElement>('refresh-button').disabled = true;
    try {
      await table.load('');
    } finally {
      if (!disposed && version === sequence) {
        node('loading').hidden = true;
        node<HTMLButtonElement>('refresh-button').disabled = false;
      }
    }
  }
  function showAdd(): void {
    form.reset();
    node('add-org-error').hidden = true;
    dialog.showModal();
    idInput.focus();
  }
  function closeAdd(): void {
    if (!saving) dialog.close();
  }
  node('add-org-button').addEventListener('click', showAdd, options);
  node('empty-add-org').addEventListener('click', showAdd, options);
  node('cancel-add-org').addEventListener('click', closeAdd, options);
  node('close-add-org').addEventListener('click', closeAdd, options);
  dialog.addEventListener(
    'cancel',
    (event) => {
      event.preventDefault();
      closeAdd();
    },
    options,
  );
  form.addEventListener(
    'submit',
    (event) => {
      event.preventDefault();
      if (saving || !form.reportValidity()) return;
      saving = true;
      add.disabled = true;
      add.textContent = 'Adding…';
      node('add-org-error').hidden = true;
      void api
        .add({ id: idInput.value, hostName: hostInput.value })
        .then(async () => {
          if (disposed) return;
          dialog.close();
          notice.hidden = true;
          await load();
        })
        .catch((cause: unknown) => {
          if (!disposed) {
            node('add-org-error').textContent = message(cause);
            node('add-org-error').hidden = false;
          }
        })
        .finally(() => {
          saving = false;
          add.disabled = false;
          add.textContent = 'Add organization';
        });
    },
    options,
  );
  list.addEventListener(
    'click',
    (event) => {
      const target = event.target as HTMLElement | null;
      const remove = target?.closest<HTMLButtonElement>(
        'button[data-delete-org-id]',
      );
      if (remove?.dataset.deleteOrgId && !remove.disabled) {
        remove.disabled = true;
        void api
          .remove(remove.dataset.deleteOrgId)
          .then(async (deleted) => {
            if (deleted && !disposed) await load();
          })
          .catch((cause: unknown) => {
            if (!disposed) error(cause);
          })
          .finally(() => {
            remove.disabled = false;
          });
        return;
      }
      const button = target?.closest<HTMLButtonElement>('button[data-org-id]');
      if (button?.dataset.orgId)
        void api.open(button.dataset.orgId).catch((cause: unknown) => {
          if (!disposed) error(cause);
        });
    },
    options,
  );
  node('refresh-button').addEventListener(
    'click',
    () => {
      notice.hidden = true;
      void load();
    },
    options,
  );
  const unsubscribe = api.onChanged(() => {
    void load();
  });
  const disposeImporter = mountRunImporter(
    root,
    {
      chooseImport: () => api.chooseImport(),
      discardImport: (token) => api.discardImport(token),
      confirmImport: (token, identity) => {
        if (!identity)
          return Promise.reject(new Error('Enter the organization details.'));
        return api.confirmImport({ token, ...identity });
      },
    },
    () => null,
    load,
    true,
  );
  void load();
  return () => {
    disposed = true;
    abort.abort();
    table.dispose();
    disposeImporter();
    unsubscribe();
  };
}
