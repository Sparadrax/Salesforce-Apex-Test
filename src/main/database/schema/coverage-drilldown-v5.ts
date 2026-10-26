export const coverageDrilldownV5 = `
  CREATE INDEX TestClassCoverage_drilldown ON TestClassCoverage(orgId, run, apexClass, apexTestClass);
  CREATE INDEX TestMethodCoverage_drilldown ON TestMethodCoverage(orgId, run, apexClass, apexTestClass, name);
  CREATE INDEX RunTestResult_class_method ON RunTestResult(orgId, run, classId, methodName);
`;
