# Database schema — version 5

Eleven tables: the seven SFCC tables, local_records, DeploymentImport, RunReport, and RunTestResult. PK marks each component of a primary key. FK includes orgId when referring to Run or an org-scoped class. Test outcomes keep class-name snapshots; they do not imply per-test coverage attribution.

```mermaid
erDiagram
  direction TB
  Org ||--o{ Run : owns
  Org ||--o{ ApexClass : owns
  Org ||--o{ ApexTestClass : owns
  Org ||--o{ GlobalCoverage : scopes
  Org ||--o{ TestClassCoverage : scopes
  Org ||--o{ TestMethodCoverage : scopes
  Run ||--o{ GlobalCoverage : measures
  Run ||--o{ TestClassCoverage : measures
  Run ||--o{ TestMethodCoverage : measures
  ApexClass ||--o{ GlobalCoverage : covered_class
  ApexClass ||--o{ TestClassCoverage : covered_class
  ApexClass ||--o{ TestMethodCoverage : covered_class
  ApexTestClass ||--o{ TestClassCoverage : covering_test
  ApexTestClass ||--o{ TestMethodCoverage : covering_test

  Org {
    TEXT id PK "max 18"
    TEXT hostName "nullable, max 180"
  }
  Run {
    TEXT id PK "max 180"
    REAL percentage "nullable, writable"
    TEXT orgId PK,FK "max 18"
    TEXT startTime "nullable datetime text"
  }
  ApexClass {
    TEXT id PK "max 18"
    TEXT name "nullable, max 180"
    TEXT orgId PK,FK "max 18"
  }
  ApexTestClass {
    TEXT id PK "max 18"
    TEXT name "nullable, max 180"
    TEXT orgId PK,FK "max 18"
  }
  GlobalCoverage {
    TEXT apexClass PK,FK "max 18"
    TEXT run PK,FK "max 180"
    TEXT orgId PK,FK "max 18"
    INTEGER numLineCovered "nullable"
    INTEGER numLineUncovered "nullable"
    REAL percentage "generated, nullable"
  }
  TestClassCoverage {
    TEXT apexClass PK,FK "max 18"
    TEXT apexTestClass PK,FK "max 18"
    TEXT run PK,FK "max 180"
    TEXT orgId PK,FK "max 18"
    INTEGER numLineCovered "nullable"
    INTEGER numLineUncovered "nullable"
    REAL percentage "generated, nullable"
  }
  TestMethodCoverage {
    TEXT name PK "max 180"
    TEXT apexClass PK,FK "max 18"
    TEXT apexTestClass PK,FK "max 18"
    TEXT run PK,FK "max 180"
    TEXT orgId PK,FK "max 18"
    INTEGER numLineCovered "nullable"
    INTEGER numLineUncovered "nullable"
    REAL percentage "generated, nullable"
  }
  local_records {
    INTEGER id PK "autoincrement"
    TEXT collection "not null, unique with key"
    TEXT key "not null, unique with collection"
    TEXT json "not null, valid JSON"
    INTEGER updated_at "not null"
  }
  Run ||--o| DeploymentImport : retains_source
  DeploymentImport {
    TEXT run PK,FK
    TEXT orgId PK,FK
    TEXT sourceName "not null"
    TEXT importedAt "not null, UTC datetime"
    TEXT document "not null, complete valid JSON"
  }
  Run ||--o| RunReport : summarizes
  Run ||--o{ RunTestResult : records_outcomes
  RunReport {
    TEXT run PK,FK
    TEXT orgId PK,FK
    TEXT status "not null"
    INTEGER testsRun "not null"
    INTEGER failures "not null"
  }
  RunTestResult {
    TEXT run PK,FK
    TEXT orgId PK,FK
    INTEGER testIndex PK
    TEXT classId "not null"
    TEXT className "not null"
    TEXT methodName "not null"
    TEXT outcome "not null"
    REAL duration "nullable milliseconds"
    TEXT message "nullable excerpt"
  }
```

Coverage percentage is generated for the three coverage tables; Run.percentage is a weighted stored aggregate. All relational tables use STRICT and WITHOUT ROWID. local_records uses its autoincrement integer key.

Run history additionally uses Run_org_date on (orgId, COALESCE(startTime, ''), id). RunReport and RunTestResult are indexed by their primary keys for scoped run and outcome retrieval. Existing SFCC foreign-key and coverage indexes are unchanged. See [SFCC model](sfcc-model.md) for the original seven tables and [org import](org-import.md) for current import and migration behavior.

Migration 5 adds TestClassCoverage_drilldown (orgId, run, apexClass, apexTestClass), TestMethodCoverage_drilldown (orgId, run, apexClass, apexTestClass, name), and RunTestResult_class_method (orgId, run, classId, methodName). No tables or columns were added.
