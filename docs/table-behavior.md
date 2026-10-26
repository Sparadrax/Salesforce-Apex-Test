# Tables and organization deletion

## Sorting

Click a data-column header to sort ascending; click the active header again to reverse it. Arrows and aria-sort indicate the current direction. Organization names, Apex/test-class names and percentages, method names/outcomes/percentages, and the history window's plotted-data table are sortable. Action buttons are not data columns.

Org and coverage tables sort on the SQLite worker across the entire result set, not only the rows currently loaded. Sort-aware keyset cursors preserve the column, direction, value, stable ID tie-breaker, and org/run/class scope. Null values stay last in both directions. Changing a sort resets cursor loading and rejects late responses from the previous order; selected parent identities stay intact. SQL sort expressions are allowlisted and values are bound parameters.

The graph's plotted-data table sorts its already bounded complete response in the renderer. Sorting that table does not change the graph's chronological order. Backend callers that omit a sort retain the earlier ID/name cursor behavior.

## Scrolling instead of page controls

Organization, Apex-class, test-class, and method tables have no page number, Previous button, or Next button. They load cursor batches of 50 rows automatically near the bottom of their scroll container. Each request is serialized per table; existing rows and selected parents remain in place when another batch is appended. A parent/run change clears its descendants and invalidates older pending responses.

The shared renderer controller is `renderer/shared/scroll-table.ts`. It uses IntersectionObserver with a scroll-event fallback, cleans up its observers/listeners, and guards repeated cursors. Rows already loaded remain in the DOM as scrolling continues; startup does not eagerly load the entire dataset. Keyboard users can focus the scroll area and scroll it normally. The backend's indexed cursor API is unchanged.

## First-table coverage colors

Only the Apex-class table receives coverage-status row styling:

- Less than 75%: red.
- 75% through 80%, inclusive: yellow.
- Greater than 80%: normal row style, with no green coverage highlight.
- Unknown percentage: normal style and a dash.

Selection remains visible over the status color. Percentage text and accessible labels accompany the color.

## Delete organization

Each org-list row has a Delete action. Main presents a native confirmation dialog with Cancel as the default; it describes the org and removal of saved runs, tests, coverage, and imported JSON. Cancel performs no writes. Only the registered org-list window can request this action.

Confirmed deletion runs on the database worker in one child-first transaction, preserving restrictive foreign keys. It removes RunTestResult, RunReport, TestMethodCoverage, TestClassCoverage, GlobalCoverage, DeploymentImport, ApexTestClass, ApexClass, Run, and finally Org for that org ID. Other orgs and generic local settings are preserved. Any failure rolls the transaction back. Pending imports for the deleted org are released after commit.

The main window registry closes org and class-history windows belonging to the deleted org, then updates other organization lists. The list window and other orgs' windows stay open. No schema changes or automatic rebuilding are required for source validation.

Tests cover scroll continuation/selection retention, stale requests, exact 75/80 boundaries, delete/cancel UI behavior, complete child cleanup, other-org isolation, rollback, and scoped window closure.
