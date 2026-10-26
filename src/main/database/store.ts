import { DatabaseSync } from 'node:sqlite';
import type {
  DatabaseStatus,
  LocalRecord,
  LocalRecordInput,
  RecordPage,
  RecordPageRequest,
} from '../../shared/contracts/database';
import { batchInput, collectionName, pageInput, recordKey } from './validation';
import { migrate } from './migrations';
import { OrgRepository } from '../features/orgs/repository';
import { CoverageRepository } from '../features/orgs/coverage-repository';
import { CoverageHistoryRepository } from '../features/coverage-history/repository';

/** Only instantiate in the database worker or tests. All SQL is parameterized. */
export class LocalStore {
  readonly orgs: OrgRepository;
  readonly coverage: CoverageRepository;
  readonly history: CoverageHistoryRepository;
  private readonly db: DatabaseSync;
  private readonly upsert;
  private readonly page;
  private readonly remove;
  private readonly find;

  constructor(filename: string) {
    this.db = new DatabaseSync(filename);
    try {
      this.db.exec(`
        PRAGMA busy_timeout = 5000;
        PRAGMA journal_mode = WAL;
        PRAGMA synchronous = FULL;
        PRAGMA foreign_keys = ON;
        PRAGMA cache_size = -16384;
        PRAGMA temp_store = FILE;
        PRAGMA wal_autocheckpoint = 1000;
      `);
      migrate(this.db);
      this.orgs = new OrgRepository(this.db);
      this.coverage = new CoverageRepository(this.db);
      this.history = new CoverageHistoryRepository(this.db);
      this.upsert = this.db.prepare(`
        INSERT INTO local_records(collection, key, json, updated_at) VALUES (?, ?, ?, ?)
        ON CONFLICT(collection, key) DO UPDATE SET json = excluded.json, updated_at = excluded.updated_at
      `);
      this.page = this.db.prepare(`
        SELECT id, key, json, updated_at AS updatedAt FROM local_records
        WHERE collection = ? AND id > ? ORDER BY id LIMIT ?
      `);
      this.remove = this.db.prepare(
        'DELETE FROM local_records WHERE collection = ? AND key = ?',
      );
      this.find = this.db.prepare(
        'SELECT id, key, json, updated_at AS updatedAt FROM local_records WHERE collection = ? AND key = ?',
      );
    } catch (error) {
      this.db.close();
      throw error;
    }
  }

  status(): DatabaseStatus {
    return {
      engine: 'sqlite',
      schemaVersion: Number(
        this.db.prepare('PRAGMA user_version').get()?.user_version,
      ),
      journalMode: String(
        this.db.prepare('PRAGMA journal_mode').get()?.journal_mode,
      ),
    };
  }

  putBatch(collection: string, records: LocalRecordInput[]): number {
    const name = collectionName(collection);
    const inputs = batchInput(records);
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const now = Date.now();
      for (const record of inputs)
        this.upsert.run(name, record.key, record.json, now);
      this.db.exec('COMMIT');
      return inputs.length;
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }

  list(request: RecordPageRequest): RecordPage {
    const { collection, afterId, limit } = pageInput(request);
    const records = this.page.all(
      collection,
      afterId,
      limit + 1,
    ) as unknown as LocalRecord[];
    const more = records.length > limit;
    if (more) records.pop();
    return { records, nextCursor: more ? (records.at(-1)?.id ?? null) : null };
  }

  delete(collection: string, key: string): boolean {
    return (
      this.remove.run(collectionName(collection), recordKey(key)).changes !== 0
    );
  }

  close(): void {
    this.orgs.dispose();
    this.db.close();
  }

  get(collection: string, key: string): LocalRecord | null {
    return (
      (this.find.get(collectionName(collection), recordKey(key)) as unknown as
        | LocalRecord
        | undefined) ?? null
    );
  }
}
