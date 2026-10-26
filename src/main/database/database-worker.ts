import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { parentPort, workerData } from 'node:worker_threads';
import type { WorkerRequest, WorkerResponse, DatabaseResult } from './protocol';
import { LocalStore } from './store';
import { ImportValidationError } from '../features/orgs/import-validation';

const port = parentPort;
if (!port) throw new Error('Database must run in a worker');
const filename = String(workerData.filename);
mkdirSync(path.dirname(filename), { recursive: true });
const store = new LocalStore(filename);

port.on('message', ({ id, command }: WorkerRequest) => {
  try {
    let result: DatabaseResult;
    switch (command.operation) {
      case 'orgs:delete':
        result = store.orgs.remove(command.orgId);
        break;
      case 'history:identity':
        result = store.history.current(command.orgId, command.apexClass);
        break;
      case 'history:query':
        result = store.history.query(
          command.orgId,
          command.apexClass,
          command.range,
        );
        break;
      case 'coverage:tests':
        result = store.coverage.coveringTests(
          command.orgId,
          command.runId,
          command.apexClass,
          command.afterId,
          command.sort,
        );
        break;
      case 'coverage:methods':
        result = store.coverage.methods(
          command.orgId,
          command.runId,
          command.apexClass,
          command.testClass,
          command.afterName,
          command.sort,
        );
        break;
      case 'orgs:get':
        result = store.orgs.get(command.orgId);
        break;
      case 'orgs:add':
        result = store.orgs.add(command.orgId, command.hostName);
        break;
      case 'orgs:runs':
        result = store.orgs.runs(command.orgId, command.cursor);
        break;
      case 'orgs:tests':
        result = store.orgs.tests(
          command.orgId,
          command.runId,
          command.afterIndex,
        );
        break;
      case 'orgs:coverage':
        result = store.orgs.coverage(
          command.orgId,
          command.runId,
          command.afterId,
          command.sort,
        );
        break;
      case 'orgs:release':
        store.orgs.releaseSession(command.session);
        result = null;
        break;
      case 'orgs:list':
        result = store.orgs.list(command.afterId, command.sort);
        break;
      case 'orgs:prepare':
        result = store.orgs.prepareFile(
          command.filename,
          command.session,
          command.targetOrgId,
        );
        break;
      case 'orgs:commit':
        result = store.orgs.commit(
          command.token,
          command.orgId,
          command.hostName,
          command.session,
        );
        break;
      case 'orgs:discard':
        store.orgs.discard(command.token, command.session);
        result = null;
        break;
      case 'status':
        result = store.status();
        break;
      case 'putBatch':
        result = store.putBatch(command.collection, command.records);
        break;
      case 'list':
        result = store.list(command.request);
        break;
      case 'delete':
        result = store.delete(command.collection, command.key);
        break;
      case 'get':
        result = store.get(command.collection, command.key);
        break;
      case 'close':
        store.close();
        result = null;
        break;
    }
    port.postMessage({ id, ok: true, result } satisfies WorkerResponse);
    if (command.operation === 'close') port.close();
  } catch (error) {
    if (!(error instanceof ImportValidationError))
      console.error('Database operation failed:', error);
    port.postMessage({
      id,
      ok: false,
      error:
        error instanceof ImportValidationError
          ? error.message
          : 'Local database operation failed. Check the file and available disk space, then try again.',
    } satisfies WorkerResponse);
  }
});
