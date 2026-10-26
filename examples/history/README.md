# Six additional demo runs

Import these files into `00D000000000001EAA` / `apex-demo.my.salesforce.com`:

| File                            | Test start date (UTC)   |
| ------------------------------- | ----------------------- |
| deployment-demo-2026-10-08.json | October 8, 2026, 14:00  |
| deployment-demo-2026-10-11.json | October 11, 2026, 14:00 |
| deployment-demo-2026-10-14.json | October 14, 2026, 14:00 |
| deployment-demo-2026-10-17.json | October 17, 2026, 14:00 |
| deployment-demo-2026-10-20.json | October 20, 2026, 14:00 |
| deployment-demo-2026-10-23.json | October 23, 2026, 14:00 |

Each has a distinct run ID, the same 50 Apex-class and 50 test-class IDs as the original demo, and 249 methods (4–6 per test class). Coverage and test outcomes vary across dates. Full class/method coverage links are included using the existing synthetic sfccCoverage extension.

Import the six files plus the original October 26 demo to obtain seven history points per class. Import order does not matter. Reimporting a file updates its existing run instead of duplicating it. No application rebuild is needed for these data files.

Regenerate with `node scripts/generate-demo-history.mjs`. This preserves the original demo file. All records are fictional.
