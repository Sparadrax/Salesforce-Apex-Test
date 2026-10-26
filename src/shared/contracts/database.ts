export interface LocalRecordInput {
  key: string;
  /** JSON text, capped at 64 KiB per record. */
  json: string;
}

export interface LocalRecord extends LocalRecordInput {
  id: number;
  updatedAt: number;
}

export interface RecordPageRequest {
  collection: string;
  afterId?: number;
  limit?: number;
}

export interface RecordPage {
  records: LocalRecord[];
  nextCursor: number | null;
}

export interface DatabaseStatus {
  engine: 'sqlite';
  schemaVersion: number;
  journalMode: string;
}

export interface DatabaseApi {
  status(): Promise<DatabaseStatus>;
  putBatch(collection: string, records: LocalRecordInput[]): Promise<number>;
  get(collection: string, key: string): Promise<LocalRecord | null>;
  list(request: RecordPageRequest): Promise<RecordPage>;
  delete(collection: string, key: string): Promise<boolean>;
}
