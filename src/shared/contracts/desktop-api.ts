import type { DatabaseApi } from './database';
import type { OrgsApi, OrgRunsApi, WindowContext } from './orgs';
import type { CoverageHistoryApi } from './coverage-history';

/** The complete renderer-facing desktop API. Keep Electron types out of this contract. */
export interface DesktopApi {
  readonly orgs: OrgsApi;
  readonly runs: OrgRunsApi;
  readonly history: CoverageHistoryApi;
  readonly context: () => Promise<WindowContext>;
  readonly database: DatabaseApi;
  readonly platform: string;
  readonly versions: {
    readonly electron: string;
    readonly chrome: string;
    readonly node: string;
  };
}
