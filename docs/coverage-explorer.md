# Org popup: run and coverage explorer

Clicking an org in the main window opens an independent popup. Its main content is a run picklist and exactly three linked tables.

Right-click an Apex class in the first table to open its [coverage-history graph](coverage-history.md) in another window, with a selectable date range.

## Pick a run

The picklist contains all saved runs, newest dated run first. The renderer fetches run metadata in serial pages of 50 and fills the picklist once the history is loaded. Only run metadata is loaded for the picklist; detailed test and coverage data is fetched for the current selection. The latest run is selected initially. Each popup keeps its own selection.

## Three linked tables

1. **Apex classes** shows the selected run's class/trigger names and aggregate coverage percentages. Click a name or row to select it.
2. **Test classes** shows only test classes with stored coverage links to the selected Apex class, and each test class's coverage percentage of that Apex class. Select a test class to continue.
3. **Test methods** shows methods of the selected test class, their passed/failed outcome, and their coverage percentage of the selected Apex class. Failure-message excerpts appear under method names when available.

Selections are highlighted and available through keyboard-focusable buttons. Changing the run clears all class/test selections. Changing an Apex class clears both downstream tables, and changing a test class clears the method table. Changing a parent table's page clears its descendants as well. Request sequence checks prevent old responses from overwriting a newer selection.

Every table fetches indexed cursor batches of 50 records automatically as you scroll; there are no page labels or Previous/Next controls. Loaded rows and selected parents remain in place when more rows arrive. Tables appear side by side on wide windows and stack in order on narrower ones. JSON import and separate windows for the same org remain available. See [table behavior](table-behavior.md) for coverage colors and org deletion.

## Data meanings

- Apex class percentage comes from `GlobalCoverage`.
- Test-class percentage comes from `TestClassCoverage` for the exact org/run/Apex-class/test-class tuple.
- Method percentage comes from `TestMethodCoverage` for that tuple plus the method name.
- Method outcomes come from `RunTestResult`, matched by org, run, test-class ID, and method name. If repeated results include a failure, the displayed outcome remains failed. Coverage alone never implies success.
- A method with a known outcome but no supplied coverage displays a dash for coverage. A method with coverage but no recorded outcome displays Unknown. Skipped/other non-pass/fail outcomes remain explicit.
- A method-only coverage link can identify a covering test class, but its class-level percentage remains unknown unless `TestClassCoverage` supplies it. Percentages are not summed or averaged across methods to invent a class percentage.

Standard Metadata API deployment results typically supply aggregate coverage and test outcomes without mapping lines to each test class/method. Those files still populate the first table and retain their test outcomes, but do not establish the links required for the second table. The UI explains that detailed coverage links were not supplied. Aggregate-only imports do not fabricate attribution. Explicit detailed rows can now be supplied through the optional application-specific sfccCoverage version-1 fixture/export extension, or already exist in the relational model. See [demo data](../examples/README.md) for the format; this extension is not part of the Salesforce Metadata API.

## Implementation

- `src/renderer/features/runs/runs.ts`: run picklist and popup orchestration
- `src/renderer/features/runs/coverage-explorer.ts`: dependent selections and row presentation
- `src/renderer/features/runs/paged-table.ts`: bounded page state and request sequencing
- `src/main/features/orgs/coverage-repository.ts`: scoped relationship/outcome queries
- `src/main/database/schema/coverage-drilldown-v5.ts`: indexes for class/test/method lookup

Schema version 5 adds indexes only and preserves existing data. Source tests cover click flow, all history pages in the picklist, stale-response protection, missing data, failed outcomes, indexed pagination, and org/class isolation. No build or packaging is needed for those checks.

Complete Salesforce CLI test-report exports with coverage.records now provide native line attribution for the second and third tables. The importer validates these records and unions method-covered line sets per test class. Reports previously imported without this support must be reimported after rebuilding. See [org import](org-import.md#native-cli-method-coverage).

## Coverage change from the previous run

Apex class percentages show a green upward chevron when improved, a red downward chevron when decreased, and an equals sign when unchanged. Hover text and accessible labels provide the previous and current percentages. Existing red/yellow row thresholds remain independent of change direction.

The worker resolves the immediately preceding dated run within the same org once per coverage page, using the same descending date/ID order as the run picker. Selecting a historical run compares it with its own predecessor. Tied timestamps use the stable run-ID order; undated runs have no comparison. Each page joins only its classes to coverage in that exact preceding run. Missing class coverage, an unknown percentage, or no predecessor produces a neutral dash; the query does not skip backward to a different run. Known zero coverage remains comparable. Comparisons use the same rounded percentages displayed in the tables and are preserved across sorting and cursor batches. No schema migration or reimport is needed.
