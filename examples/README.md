# Demo deployment: 50 classes

Import `deployment-demo-50-classes.json` into the fictional org `00D000000000001EAA` / `apex-demo.my.salesforce.com`.

- 50 Apex classes and 50 distinct test classes.
- 4–6 unique methods per test class; 249 methods total.
- 235 passing methods and 14 failing methods. The synthetic deployment is marked Failed to match those failures.
- Each Apex class is covered by two test classes.
- 100 test-class coverage links and 498 method/class coverage links. Counts come from generated line sets, so class coverage is based on unions rather than sums of overlapping methods.

The main payload uses the Salesforce deployment-result shape. The optional `sfccCoverage` version-1 section is an **application-specific synthetic fixture/export extension**, not a standard Salesforce Metadata API field. It contains explicit testClassCoverage and testMethodCoverage arrays using model field names; percentages are calculated by SQLite. The source importer validates parent IDs, method references, unique keys, and totals before storing it in the same atomic transaction as the deployment.

This extension needs the updated source importer. The previously compiled installer imports the aggregate Salesforce fields but does not populate detailed coverage from this section. Rebuild the app before using this file to demonstrate all three tables in the installed version; no build was performed while generating the file.

Regenerate deterministically with `node scripts/generate-demo-deployment.mjs`. Seed: 20261026. All IDs and records are synthetic; there are no credentials.
