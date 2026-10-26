# Salesforce coverage model (SFCC)

Migration 2 recreates the model from `C:\Users\louis\Desktop\jqProject\louis.dbeux-project\ElectronApp\mariaDBDef.js` in the embedded SQLite database. The original file is unchanged. This creates the schema; it does not connect to MariaDB or copy existing MariaDB records.

The SQL lives in `src/main/database/schema/sfcc-v2.ts`; TypeScript row and write types live in `src/shared/contracts/sfcc-model.ts`. Existing version-1 databases upgrade automatically on startup, preserving `local_records`. New installations receive both migrations. Migration DDL and the schema version commit together.

## Tables

Names, column order, and primary key order match the source model.

| Table              | Columns                                                                                  | Primary key                                |
| ------------------ | ---------------------------------------------------------------------------------------- | ------------------------------------------ |
| Org                | id, hostName                                                                             | id                                         |
| Run                | id, percentage, orgId, startTime                                                         | id, orgId                                  |
| ApexClass          | id, name, orgId                                                                          | id, orgId                                  |
| ApexTestClass      | id, name, orgId                                                                          | id, orgId                                  |
| TestClassCoverage  | apexClass, apexTestClass, run, orgId, numLineCovered, numLineUncovered, percentage       | apexClass, apexTestClass, run, orgId       |
| GlobalCoverage     | apexClass, run, orgId, numLineCovered, numLineUncovered, percentage                      | apexClass, run, orgId                      |
| TestMethodCoverage | name, apexClass, apexTestClass, run, orgId, numLineCovered, numLineUncovered, percentage | name, apexClass, apexTestClass, run, orgId |

Every run and class belongs to an org. Coverage references its org and the matching class/run within that same org. Test-class and method coverage also reference the matching test class. IDs may be reused across different orgs.

## SQLite translation

- `SFCC` is the logical model name. Tables live in the existing `application.sqlite` file; no MariaDB server or separate `SFCC` database is created.
- `CHAR(18)` and `CHAR(180)` become `TEXT` with corresponding maximum-length checks. Strings are not space-padded. Matching uses SQLite's case-sensitive default collation; no unspecified MariaDB server collation is reproduced.
- Primary-key fields are explicitly non-null. Other fields retain their optional/null behavior.
- `FLOAT(5,2)` becomes `REAL`. The three coverage percentages are generated virtual columns rounded to two decimal places. `Run.percentage` remains a directly writable real value, as in the source, without automatic decimal rounding or fixed-precision enforcement.
- The coverage formula is `round(100.0 * numLineCovered / NULLIF(numLineCovered + numLineUncovered, 0), 2)`. Zero totals and null counts produce `NULL`. Generated percentages cannot be assigned directly and recalculate when counts change.
- `INT(10)` becomes SQLite `INTEGER` (64-bit). The source's `(10)` is not a ten-digit capacity limit; SQLite does not enforce MariaDB's signed 32-bit integer range here. No extra nonnegative-count rule has been invented.
- `DATETIME` becomes nullable `TEXT`. Existing date strings can be represented, but future application writes should consistently use UTC ISO 8601 strings. The database does not perform timezone conversion or validate date formats.
- Every table is `STRICT` and `WITHOUT ROWID`, using the original primary key directly rather than adding an unrelated surrogate ID.
- Foreign keys to classes and runs include `orgId`, matching those parents' composite keys. This makes the relationships enforceable in SQLite and prevents cross-org references. Deletes/updates use the default restrictive behavior; there are no automatic cascading deletions.

## Indexes and volume

Runs are indexed by `(orgId, startTime, id)`, and both class tables by `(orgId, name, id)`. Coverage tables have `(orgId, run)` and `(orgId, apexClass)` indexes; test-class and method coverage also have `(orgId, apexTestClass)` indexes. These support org/run retrieval and foreign-key checks without scanning entire coverage tables. Queries should use bounded keyset pagination over their full ordering key where necessary.

These tables are separate from the generic JSON-record API. Salesforce repositories, validated domain IPC operations, import/export, and UI workflows should be added as their feature behavior is defined. Do not expose arbitrary SQL through preload or try to store relational coverage rows via `database.putBatch`.

## Verification

Schema tests verify all table/column/primary-key definitions, generated percentages and updates, foreign keys and cross-org isolation, duplicate rejection, field lengths, nullability, strict types, migration rollback, and version-1 upgrade preservation. A synthetic 100,000-row method-coverage test verifies indexed org/run retrieval near the end of the name ordering. The Electron smoke test confirms migration 2 runs inside the packaged worker.
