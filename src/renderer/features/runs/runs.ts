import type {
  OrgRunsApi,
  OrgSummary,
  RunSummary,
} from '../../../shared/contracts/orgs';
import { element, message, dateText } from '../../shared/dom';
import { mountRunImporter } from './import-dialog';
import { mountCoverageExplorer } from './coverage-explorer';

export function mountRuns(root: Document, api: OrgRunsApi): () => void {
  const node = <T extends HTMLElement>(id: string) => element<T>(root, id);
  node('org-screen').hidden = true;
  node('run-screen').hidden = false;
  const abort = new AbortController();
  const options = { signal: abort.signal };
  let org: OrgSummary | null = null;
  let runs: RunSummary[] = [];
  let selected: RunSummary | null = null;
  let disposed = false;
  let sequence = 0;
  function error(cause: unknown): void {
    node('run-notice').textContent = message(cause);
    node('run-notice').hidden = false;
    node('run-notice').classList.add('error');
  }
  const explorer = mountCoverageExplorer(root, api, error);
  async function selectRun(id: string): Promise<void> {
    selected = runs.find((run) => run.id === id) ?? null;
    if (!selected) {
      explorer.clear();
      return;
    }
    node<HTMLSelectElement>('run-select').value = selected.id;
    node('run-date').textContent = dateText(selected.startTime);
    node('run-id').textContent = selected.id;
    node('run-status').textContent = selected.status ?? 'Imported run';
    await explorer.setRun(selected.id);
  }
  async function loadRuns(latest = false): Promise<void> {
    const version = ++sequence;
    const prior = latest ? null : selected?.id;
    node('run-loading').hidden = false;
    try {
      const [identity, first] = await Promise.all([api.current(), api.list()]);
      const all = [...first.runs];
      let cursor = first.nextCursor;
      const seen = new Set<string>();
      // Fetch only lightweight metadata in bounded pages; test and coverage rows stay lazy.
      while (cursor) {
        if (disposed || version !== sequence) return;
        const key = JSON.stringify(cursor);
        if (seen.has(key))
          throw new Error('Unable to load run history: repeated cursor.');
        seen.add(key);
        const page = await api.list(cursor);
        all.push(...page.runs);
        cursor = page.nextCursor;
      }
      if (disposed || version !== sequence) return;
      org = identity;
      runs = all;
      root.title = `${org.hostName ?? org.id} · Tests · Salesforce Apex Test`;
      node('org-window-title').textContent = org.hostName ?? org.id;
      node('org-window-id').textContent = org.id;
      node<HTMLButtonElement>('import-button').disabled = false;
      node('no-runs').hidden = runs.length > 0;
      node('run-content').hidden = runs.length === 0;
      const fragment = root.createDocumentFragment();
      for (const run of runs) {
        const option = root.createElement('option');
        option.value = run.id;
        option.textContent = `${dateText(run.startTime)} · ${run.id}`;
        fragment.append(option);
      }
      node<HTMLSelectElement>('run-select').replaceChildren(fragment);
      node('run-count').textContent =
        `${runs.length.toLocaleString()} saved runs`;
      if (runs[0])
        await selectRun(
          prior && runs.some((run) => run.id === prior) ? prior : runs[0].id,
        );
      else {
        selected = null;
        explorer.clear();
      }
    } catch (cause) {
      if (!disposed && version === sequence) error(cause);
    } finally {
      if (!disposed && version === sequence) node('run-loading').hidden = true;
    }
  }
  node('run-select').addEventListener(
    'change',
    () => {
      void selectRun(node<HTMLSelectElement>('run-select').value);
    },
    options,
  );
  node('latest-run-button').addEventListener(
    'click',
    () => {
      node('run-notice').hidden = true;
      void loadRuns(true);
    },
    options,
  );
  const stopImport = mountRunImporter(
    root,
    api,
    () => org,
    () => loadRuns(true),
  );
  const unsubscribe = api.onChanged((id) => {
    if (id === org?.id) void loadRuns();
  });
  void loadRuns(true);
  return () => {
    disposed = true;
    abort.abort();
    explorer.dispose();
    stopImport();
    unsubscribe();
  };
}
