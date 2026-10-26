/** Full source retention for deployment/test result fields outside the SFCC model. */
export const deploymentImportsV3 = `
  CREATE TABLE DeploymentImport (
    run TEXT NOT NULL,
    orgId TEXT NOT NULL,
    sourceName TEXT NOT NULL,
    importedAt TEXT NOT NULL,
    document TEXT NOT NULL CHECK(json_valid(document)),
    PRIMARY KEY(run, orgId),
    FOREIGN KEY(run, orgId) REFERENCES Run(id, orgId)
  ) STRICT, WITHOUT ROWID;
  CREATE INDEX DeploymentImport_org ON DeploymentImport(orgId);
`;
