/** Migration 2: SQLite translation of the legacy SFCC mariaDBDef.js model. */
export const sfccV2 = `
  CREATE TABLE Org (
    id TEXT NOT NULL CHECK(length(id) <= 18),
    hostName TEXT CHECK(length(hostName) <= 180),
    PRIMARY KEY(id)
  ) STRICT, WITHOUT ROWID;

  CREATE TABLE Run (
    id TEXT NOT NULL CHECK(length(id) <= 180),
    percentage REAL,
    orgId TEXT NOT NULL CHECK(length(orgId) <= 18),
    startTime TEXT,
    PRIMARY KEY(id, orgId),
    FOREIGN KEY(orgId) REFERENCES Org(id)
  ) STRICT, WITHOUT ROWID;
  CREATE INDEX Run_org_start ON Run(orgId, startTime, id);

  CREATE TABLE ApexClass (
    id TEXT NOT NULL CHECK(length(id) <= 18),
    name TEXT CHECK(length(name) <= 180),
    orgId TEXT NOT NULL CHECK(length(orgId) <= 18),
    PRIMARY KEY(id, orgId),
    FOREIGN KEY(orgId) REFERENCES Org(id)
  ) STRICT, WITHOUT ROWID;
  CREATE INDEX ApexClass_org_name ON ApexClass(orgId, name, id);

  CREATE TABLE ApexTestClass (
    id TEXT NOT NULL CHECK(length(id) <= 18),
    name TEXT CHECK(length(name) <= 180),
    orgId TEXT NOT NULL CHECK(length(orgId) <= 18),
    PRIMARY KEY(id, orgId),
    FOREIGN KEY(orgId) REFERENCES Org(id)
  ) STRICT, WITHOUT ROWID;
  CREATE INDEX ApexTestClass_org_name ON ApexTestClass(orgId, name, id);

  CREATE TABLE TestClassCoverage (
    apexClass TEXT NOT NULL CHECK(length(apexClass) <= 18),
    apexTestClass TEXT NOT NULL CHECK(length(apexTestClass) <= 18),
    run TEXT NOT NULL CHECK(length(run) <= 180),
    orgId TEXT NOT NULL CHECK(length(orgId) <= 18),
    numLineCovered INTEGER,
    numLineUncovered INTEGER,
    percentage REAL GENERATED ALWAYS AS (
      round(100.0 * numLineCovered / NULLIF(numLineCovered + numLineUncovered, 0), 2)
    ) VIRTUAL,
    PRIMARY KEY(apexClass, apexTestClass, run, orgId),
    FOREIGN KEY(orgId) REFERENCES Org(id),
    FOREIGN KEY(apexClass, orgId) REFERENCES ApexClass(id, orgId),
    FOREIGN KEY(apexTestClass, orgId) REFERENCES ApexTestClass(id, orgId),
    FOREIGN KEY(run, orgId) REFERENCES Run(id, orgId)
  ) STRICT, WITHOUT ROWID;
  CREATE INDEX TestClassCoverage_org_run ON TestClassCoverage(orgId, run);
  CREATE INDEX TestClassCoverage_org_class ON TestClassCoverage(orgId, apexClass);
  CREATE INDEX TestClassCoverage_org_test ON TestClassCoverage(orgId, apexTestClass);

  CREATE TABLE GlobalCoverage (
    apexClass TEXT NOT NULL CHECK(length(apexClass) <= 18),
    run TEXT NOT NULL CHECK(length(run) <= 180),
    orgId TEXT NOT NULL CHECK(length(orgId) <= 18),
    numLineCovered INTEGER,
    numLineUncovered INTEGER,
    percentage REAL GENERATED ALWAYS AS (
      round(100.0 * numLineCovered / NULLIF(numLineCovered + numLineUncovered, 0), 2)
    ) VIRTUAL,
    PRIMARY KEY(apexClass, run, orgId),
    FOREIGN KEY(orgId) REFERENCES Org(id),
    FOREIGN KEY(apexClass, orgId) REFERENCES ApexClass(id, orgId),
    FOREIGN KEY(run, orgId) REFERENCES Run(id, orgId)
  ) STRICT, WITHOUT ROWID;
  CREATE INDEX GlobalCoverage_org_run ON GlobalCoverage(orgId, run);
  CREATE INDEX GlobalCoverage_org_class ON GlobalCoverage(orgId, apexClass);

  CREATE TABLE TestMethodCoverage (
    name TEXT NOT NULL CHECK(length(name) <= 180),
    apexClass TEXT NOT NULL CHECK(length(apexClass) <= 18),
    apexTestClass TEXT NOT NULL CHECK(length(apexTestClass) <= 18),
    run TEXT NOT NULL CHECK(length(run) <= 180),
    orgId TEXT NOT NULL CHECK(length(orgId) <= 18),
    numLineCovered INTEGER,
    numLineUncovered INTEGER,
    percentage REAL GENERATED ALWAYS AS (
      round(100.0 * numLineCovered / NULLIF(numLineCovered + numLineUncovered, 0), 2)
    ) VIRTUAL,
    PRIMARY KEY(name, apexClass, apexTestClass, run, orgId),
    FOREIGN KEY(orgId) REFERENCES Org(id),
    FOREIGN KEY(apexClass, orgId) REFERENCES ApexClass(id, orgId),
    FOREIGN KEY(apexTestClass, orgId) REFERENCES ApexTestClass(id, orgId),
    FOREIGN KEY(run, orgId) REFERENCES Run(id, orgId)
  ) STRICT, WITHOUT ROWID;
  CREATE INDEX TestMethodCoverage_org_run ON TestMethodCoverage(orgId, run);
  CREATE INDEX TestMethodCoverage_org_class ON TestMethodCoverage(orgId, apexClass);
  CREATE INDEX TestMethodCoverage_org_test ON TestMethodCoverage(orgId, apexTestClass);
`;
