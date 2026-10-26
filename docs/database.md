# Embedded database

## Engine and ownership

The app uses SQLite through the `node:sqlite` module bundled with Electron's Node runtime. No database server, ORM, native npm addon, or platform-specific rebuild is needed. The Electron version is pinned; Node currently labels this module experimental, so upgrade Electron together with database regression tests.

The database is created on first startup at `path.join(app.getPath('userData'), 'data', 'application.sqlite')`. This is an operating-system application-data directory outside the installed app and source tree, so rebuilding the app does not replace the data. A single app-instance lock prevents duplicate app processes.

All SQL, JSON validity checking, migrations, and transactions run on a dedicated Node worker thread. Main handles authorization, bounded request validation, and communication; the renderer only receives a named, typed API through preload. Raw SQL and filesystem paths are not exposed to the UI.

## Modules

- `src/main/database/store.ts`: prepared queries and transactions
- `src/main/database/migrations.ts`: ordered, transactional schema migrations
- `src/main/database/schema/sfcc-v2.ts`: seven relational Salesforce coverage tables, introduced in migration 2
- `src/main/database/database-worker.ts`: worker entry and operation dispatch
- `src/main/database/client.ts`: asynchronous client, queue limits, failure handling, and shutdown
- `src/main/database/ipc.ts`: trusted-window and frame/origin authorization
- `src/main/database/validation.ts`: runtime limits shared by client and store
- `src/shared/contracts/database.ts`: public types

Append migrations; never rewrite one that has shipped. Newer schema versions are rejected without resetting data. Future Salesforce features should introduce domain repositories and relational tables with indexes for their actual filters. The initial `local_records` table is a namespaced JSON store for local app records; it is not a replacement for relational modeling or a full-text search index.

Schema version 2 also includes the seven tables translated from the legacy MariaDB model. See [SFCC model](sfcc-model.md) for fields, relationships, indexes, and intentional SQLite differences. These tables are available for future domain repositories; the generic JSON API does not read or write them.

Schema version 3 adds `DeploymentImport`, which preserves the complete source JSON for each imported run. The org feature now reads/writes the relational model through its own worker-backed API. See [org import](org-import.md) for supported formats and the staged import flow.

## API

```typescript
const database = window.desktop.database;

await database.putBatch('test_results', [
  { key: 'run-123', json: JSON.stringify({ passed: true, duration: 42 }) },
]);

const record = await database.get('test_results', 'run-123');
const first = await database.list({ collection: 'test_results', limit: 50 });
if (first.nextCursor !== null) {
  const next = await database.list({
    collection: 'test_results',
    afterId: first.nextCursor,
    limit: 50,
  });
}

await database.delete('test_results', 'run-123');
const status = await database.status();
```

`putBatch` atomically upserts records by `(collection, key)` and returns the number of submitted entries. Upserts preserve record IDs. `get` returns null if absent. `delete` returns whether a record existed. Collections use lowercase letters, digits, underscores, or hyphens, begin with a letter, and contain at most 64 characters. Keys contain 1–256 characters. Payloads are JSON text; parse them in the consuming feature.

## Volume and performance

- WAL journal mode, full synchronous commits, and a 5-second SQLite lock timeout.
- Prepared, parameterized statements and one transaction per batch.
- At most 250 records and 1 MiB of UTF-8 key/payload data per batch; each JSON payload is capped at 64 KiB.
- An index on `(collection, id)` supports cursor pagination, including deep pages, without `OFFSET` scans. Unique `(collection, key)` lookups are indexed too.
- Pages contain at most 50 records; at most 51 are materialized internally to detect the next page. There is no unbounded list/count API.
- At most eight outstanding operations; callers receive a busy error when the queue is full. Stream imports and await each batch instead of issuing thousands of promises.
- SQLite page cache is approximately 16 MiB; temporary SQL storage uses disk. These settings bound particular caches and messages, not the total Electron process memory.
- WAL auto-checkpoint runs every 1,000 pages. Normal shutdown drains accepted requests and closes the connection.

Pagination is a live forward scan by ID, not a frozen snapshot: concurrent updates may change existing records, and inserts may appear in later pages. A 30-second request timeout stops the worker and rejects pending operations. A write may have committed before a crash or timeout; use stable keys for idempotent upserts and verify state after restarting. Do not automatically replay non-idempotent operations.

SQLite is intended here for substantial local datasets, with one serialized writer. Actual capacity and throughput depend on record sizes, indexes, queries, free disk space, and hardware. The automated test inserts 100,000 small synthetic records and verifies an indexed deep page; it does not establish a production size or throughput guarantee. Test representative Salesforce workloads as those features are built.

For records larger than 64 KiB, introduce a dedicated domain table or streamed file/blob storage with metadata, rather than raising every IPC limit. For large analytical queries or concurrent multi-user writes, reassess the storage design.

## Data maintenance

The database is local and unencrypted. Keep Salesforce credentials in operating-system credential storage when authentication is implemented. Store ordinary application data here.

For a manual backup, fully quit the application and copy its entire `data` directory to a backup location. Restore that directory only while the app is closed. Do not copy only the main SQLite file from a running app because committed changes may still be in WAL sidecar files. Online backup, encryption, retention rules, and a backup UI are not implemented.

## Verification

`npm test` checks migration/reopen persistence, upsert identity, collection isolation, cursor traversal, keyed access/deletion, SQL parameter safety, transaction rollback, input limits, future-schema rejection, and 100,000-record indexing.

After `npm run package`, run `npm run test:electron` to exercise the built worker and real preload/IPC path. It uses temporary application data and verifies CRUD, oversized-request rejection, queue pressure, unauthorized-window rejection, and normal shutdown. To check the worker inside an ASAR archive on Windows:

```powershell
npm run test:electron -- "out/Salesforce Apex Test-win32-x64/resources/app.asar/.vite/build/main.cjs"
```

Run the same checks on macOS before a Mac release.

## Independent org windows (schema 4)

The main screen adds and opens orgs. Org windows read run history and import JSON through a scoped API. RunReport stores the imported summary, and RunTestResult stores bounded, paginated individual outcomes. Both reference Run by (run, orgId). A date expression index supports descending history with deterministic ID ties and undated runs last. Existing DeploymentImport archives are backfilled once in migration 4. The full original JSON is retained.

Previews are owned by a main-process window session, with up to eight staged previews and 64 MiB combined source JSON across all windows. Canceling or closing a window releases only its preview. See [org import](org-import.md) for the current two-screen flow and concurrent-window behavior; it supersedes the older single-preview description above.

## Coverage recovery (schema 6)

Older compiled builds retained the demo JSON but ignored its optional detailed-coverage section. Migration 6 transactionally recovers TestClassCoverage and TestMethodCoverage from that retained source, without changing org/run identity or requiring re-import. The packaged recovery was verified against an isolated backup of the affected database: clicking an Apex class returned two test classes, and clicking one returned four methods with outcomes and percentages. The live database was not edited by the verification.
