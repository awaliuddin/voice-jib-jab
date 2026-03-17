/** @type {import('@stryker-mutator/api/core').PartialStrykerOptions} */
export default {
  testRunner: "jest",
  jest: {
    projectType: "custom",
    configFile: "jest.stryker.config.js",
    enableFindRelatedTests: true,
  },
  mutate: [
    "src/insurance/policy_gate.ts",
    "src/insurance/allowed_claims_registry.ts",
    "src/orchestrator/LaneArbitrator.ts",
  ],
  coverageAnalysis: "perTest",
  reporters: ["progress", "clear-text", "json"],
  jsonReporter: {
    fileName: "reports/mutation/mutation.json",
  },
  thresholds: {
    high: 60,
    low: 40,
    break: null,
  },
  timeoutMS: 30000,
  concurrency: 2,
  disableTypeChecks: true,
};
