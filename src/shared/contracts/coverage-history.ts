export interface ClassHistoryIdentity {
  orgId: string;
  hostName: string | null;
  classId: string;
  className: string | null;
  firstDate: string | null;
  lastDate: string | null;
  undatedRuns: number;
}
/** UTC ISO timestamps; the upper bound is exclusive to include the whole selected end day. */
export interface HistoryRange {
  from: string;
  toExclusive: string;
}
export interface HistoryPoint {
  at: string;
  percentage: number | null;
  minimum: number | null;
  maximum: number | null;
  count: number;
  runId: string | null;
}
export interface CoverageHistory {
  totalRuns: number;
  aggregated: boolean;
  points: HistoryPoint[];
}
export interface CoverageHistoryApi {
  current(): Promise<ClassHistoryIdentity>;
  query(range: HistoryRange): Promise<CoverageHistory>;
  onChanged(callback: (orgId: string) => void): () => void;
}
