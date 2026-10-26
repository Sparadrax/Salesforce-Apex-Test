import { Buffer } from 'node:buffer';
import type {
  LocalRecordInput,
  RecordPageRequest,
} from '../../shared/contracts/database';

export const MAX_BATCH_BYTES = 1024 * 1024;
export const MAX_RECORD_BYTES = 64 * 1024;

export function collectionName(value: unknown): string {
  if (typeof value !== 'string' || !/^[a-z][a-z0-9_-]{0,63}$/.test(value)) {
    throw new Error('Invalid collection name');
  }
  return value;
}

export function recordKey(value: unknown): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > 256) {
    throw new Error('Record key must contain 1–256 characters');
  }
  return value;
}

export function batchInput(value: unknown): LocalRecordInput[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > 250) {
    throw new Error('A batch must contain 1–250 records');
  }
  let bytes = 0;
  return value.map((item: unknown) => {
    if (
      !item ||
      typeof item !== 'object' ||
      !('key' in item) ||
      !('json' in item)
    ) {
      throw new Error('Invalid record');
    }
    const key = recordKey(item.key);
    if (
      typeof item.json !== 'string' ||
      Buffer.byteLength(item.json) > MAX_RECORD_BYTES
    ) {
      throw new Error('Record JSON exceeds 64 KiB or is not a string');
    }
    bytes += Buffer.byteLength(item.json) + Buffer.byteLength(key);
    if (bytes > MAX_BATCH_BYTES) throw new Error('Batch exceeds 1 MiB');
    // SQLite's json_valid CHECK validates JSON inside the worker transaction.
    return { key, json: item.json };
  });
}

export function pageInput(value: unknown): Required<RecordPageRequest> {
  if (!value || typeof value !== 'object' || !('collection' in value)) {
    throw new Error('Invalid page request');
  }
  const afterId = 'afterId' in value ? value.afterId : 0;
  const limit = 'limit' in value ? value.limit : 50;
  if (
    typeof afterId !== 'number' ||
    !Number.isSafeInteger(afterId) ||
    afterId < 0
  ) {
    throw new Error('Invalid cursor');
  }
  if (
    typeof limit !== 'number' ||
    !Number.isInteger(limit) ||
    limit < 1 ||
    limit > 50
  ) {
    throw new Error('Page size must be 1–50');
  }
  return { collection: collectionName(value.collection), afterId, limit };
}
