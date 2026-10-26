# Organization windows and Salesforce JSON import

## First screen: organization list

The main window contains only the saved org list and an **Add organization** action. Adding an org requires its Salesforce org ID and instance hostname, and does not create a run or import results. Duplicate IDs are rejected without changing the existing org. IDs are canonicalized from 15 to 18 characters; HTTPS instance URLs are normalized to hostnames.

Click the organization name or **Open tests** to create a new native window. Every click creates a fresh, unparented window, even for an org that is already open. Closing the main window does not close its org windows. Each window has its own selected run, pages, and import preview. Changes refresh the main list and other windows for the same org without resetting their selected historical run when it is still on the current history page.

## Second screen: org test results

An org window opens on its most recent run by test start date, descending. Run ID is the deterministic tie-breaker; undated runs come after dated ones. Importing an older file does not make that run the latest. The run selector includes all saved runs; **Latest run** returns to the most recent run.

The window shows run date/ID, deployment status, total tests, failures, weighted aggregate coverage, individual test outcomes and durations, failure-message excerpts, and class/trigger coverage. Run metadata is fetched in pages of 50 to populate the full picklist. Coverage detail tables each keep a single indexed cursor page of at most 50 rows in the renderer. Full failure messages, stack traces, and other details remain in the retained source document; displayed failure excerpts are capped at 4,096 characters.

## Import flow

1. Open the desired org window and choose **Import JSON**.
2. Select a local `.json` file in the operating system picker. The worker reads and validates it; the renderer never receives the path or full JSON.
3. Review the file, run ID, deployment status, class count, test count, and failures. The destination org is fixed to the current window. A file identifying a different org is rejected; if org identity is absent, the current org supplies it.
4. Choose **Import results**. Run, classes, aggregate coverage, normalized test outcomes, and original JSON commit atomically. Canceling writes nothing. A failed transaction rolls back and remains retryable.
5. The importing window shows the latest dated run. Other windows for that org refresh their current view. Existing unrelated runs are preserved.

Each window has a distinct main-process identity and worker import session. Tokens cannot be consumed by another window. Each preview expires after 10 minutes and is released when its window closes. Across all windows, staged source JSON is limited to 64 MiB and eight previews; each file is limited to the remaining shared capacity. Parsing and writes run on the worker. Imports do not authenticate or contact Salesforce.

## Supported Salesforce formats

### Deployment JSON

The primary input is a completed deployment report, such as `sf project deploy report --job-id <deployment-id> --target-org <alias> --json`. The importer supports CLI envelopes (`result.details.runTestResult`) and unwrapped Metadata API DeployResult documents (`details.runTestResult`). Include test details. Async acknowledgements, running deployments, and files without any test results or coverage are rejected. Failed deployments with usable results are supported.

`examples/deployment-result.json` contains a minimal synthetic example with no real Salesforce data. The org identity is intentionally absent, since the selected org window supplies it.

| Source                                                | Destination                             |
| ----------------------------------------------------- | --------------------------------------- |
| deployment id                                         | Run.id                                  |
| startDate, or createdDate                             | Run.startTime, UTC ISO 8601             |
| current org window                                    | Org identity and all child orgId fields |
| codeCoverage IDs and names                            | ApexClass, including covered triggers   |
| numLocations minus numLocationsNotCovered             | GlobalCoverage.numLineCovered           |
| numLocationsNotCovered                                | GlobalCoverage.numLineUncovered         |
| successes/failures class IDs and names                | ApexTestClass                           |
| successes/failures methods, outcomes, times, messages | RunTestResult                           |
| test counts and deployment status                     | RunReport                               |
| complete source document                              | DeploymentImport.document               |

Singleton result objects and arrays are accepted, as are numeric strings. The importer validates counts and coverage totals. Deployment JSON supplies aggregate coverage rather than per-test line attribution, so it does not invent TestClassCoverage or TestMethodCoverage rows.

### CLI test-report JSON

Salesforce CLI reports with summary, tests[].ApexClass, and codecoverage (or coverage.coverage) are also supported. Tests use MethodName, Outcome, RunTime, and Message. Missing run IDs receive a deterministic SHA-256-based ID for repeatable imports. Missing dates remain undated; import time is not substituted for test execution time.

## Storage and merge behavior

The original SFCC tables remain. Schema version 3 added source retention; version 4 adds RunReport, RunTestResult, and an org/date/run index. Version 5 adds indexes for the three-table coverage drill-down. Version-3 archives are normalized once during the transactional upgrade, on the worker, so future page reads do not reparse entire documents.

Reimporting the same (run ID, org ID) updates its summary, replaces its individual test-outcome snapshot and retained source document, and upserts its aggregate coverage. Unrelated runs and orgs are untouched. Aggregate coverage entries absent from a later partial report remain stored. Run coverage is weighted by covered/total locations, not an average of class percentages, and describes this deployment rather than an independent live org-wide measurement.

## Modules and checks

- main/windows/window-registry.ts: independent trusted window identities and notifications
- main/features/orgs/ipc.ts: list-only vs org-only actions and native file selection
- main/features/orgs/repository.ts: orgs, staged imports, and paginated results
- main/features/orgs/parse-deployment.ts: Salesforce format normalization
- main/features/orgs/persist-test-results.ts: normalized outcome snapshot persistence
- renderer/features/orgs/orgs.ts: first-screen list and Add org dialog
- renderer/features/runs/runs.ts: per-window run history and results
- renderer/features/runs/import-dialog.ts: preserved import-preview flow

Run `npm run check` for source checks and tests. Source-level worker, DOM, registry, migration, and multi-session tests do not rebuild or package the app. Native window creation has not been revalidated in a newly compiled app during this change, per the user's build preference.

Format references: [Salesforce deployment formatter](https://github.com/salesforcecli/plugin-deploy-retrieve/blob/main/src/formatters/deployResultFormatter.ts) and [RunTestsResult fields](https://developer.salesforce.com/docs/platform/api/guide/sforce-api-calls-runtests-result.html).

The popup now uses a three-table class → test class → method explorer. See [coverage explorer](coverage-explorer.md) for the current layout and data meanings.

## Optional detailed fixture/export data

The source importer also supports an explicitly application-specific `sfccCoverage` version-1 section at the document root (or result). It carries `testClassCoverage` and `testMethodCoverage` arrays containing Apex/test-class IDs and covered/uncovered counts; method rows also contain name. Parent classes and method outcomes must exist in the deployment result, and count totals must match the covered Apex class. Duplicate or invalid rows reject the entire import. Percentages are generated in SQLite, not supplied by the fixture. This does not alter how ordinary Salesforce JSON is interpreted or infer missing attribution.

See [demo data](../examples/README.md). The importer extension requires a new build when using a previously compiled installer.
