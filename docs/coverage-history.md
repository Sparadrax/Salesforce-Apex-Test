# Coverage history windows

Right-click an Apex-class row in the first coverage table to open a separate native history window. Right-clicking again opens another independent window. Left-click still drives the three-table drill-down. The class-table hint advertises the right-click action; a keyboard context-menu action on its class button uses the same handler.

Each history window is registered in main with an immutable organization and class identity. Its API accepts only a date range, not a replacement org/class. Opening history first validates that the class exists in the originating org. Existing frame/origin checks apply to all history IPC operations.

## Controls and values

- Start and inclusive end-day date pickers with Apply range.
- 7-, 30-, and 90-calendar-day presets, plus All time.
- All time defaults to the first and last dated run for this class.
- A graph of this class's GlobalCoverage percentage across its dated runs, ordered by test-run start timestamp.
- Immediate visible tooltips on hover/focus with date, percentage, and run ID, and a sortable collapsible table of plotted values. Tooltips follow the pointer, are clamped inside the graph area, and can be dismissed with Escape. SVG title labels remain as a fallback.
- A 75% reference line; the vertical axis stays fixed at 0–100%.

Local calendar days convert to UTC query boundaries. The upper bound is the next local midnight, so the selected end day is fully included even across daylight-saving changes. Reversed or invalid ranges are rejected. Undated runs are omitted and their count is shown. A 0% result is a valid point; null percentages create gaps instead of artificial zeroes. A single run displays one centered point.

Up to 1,000 matching runs are returned individually. Larger histories are reduced by SQLite into at most 500 time groups, with an average and minimum/maximum for each group. The graph labels averaged views explicitly and shows their min/max ranges. Group averages ignore unknown percentages; total group counts still include their runs. Narrow the date range for individual-run detail. This bounds renderer data and DOM size; it does not promise fixed query time for arbitrarily large databases.

Imports notify history windows for the same org. Custom date ranges stay selected; All time expands to updated first/last bounds. Requests have sequence guards so older responses cannot overwrite a newer selected range. Closing one history window has no effect on other org/history windows.

## Modules

- `main/features/coverage-history/repository.ts`: date validation, scoped history and worker-side grouping
- `main/features/coverage-history/ipc.ts`: authorized opening and immutable-window history queries
- `shared/contracts/coverage-history.ts`: history request/response types
- `renderer/features/history/history.ts`: filters, loading/error state and live updates
- `renderer/features/history/date-range.ts`: local calendar-day conversion
- `renderer/features/history/chart.ts`: bounded SVG rendering without a chart dependency

History UI code and CSS load only in history windows. Existing database indexes are reused; no schema migration is needed. Source tests cover filtering/isolation, aggregation bounds, DST end-day handling, missing/zero values, right-click behavior, and out-of-order responses. Native packaging has not been run for this feature; rebuild before using it in a previously compiled app.
