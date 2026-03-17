/**
 * Jest config for Stryker mutation testing.
 * Excludes T-013 and T-016 — they depend on real filesystem knowledge files
 * (../knowledge/nxtg_facts.jsonl) that are not available in Stryker's sandbox.
 */

/** @type {import('jest').Config} */
export default {
  preset: "ts-jest/presets/default-esm",
  testEnvironment: "node",
  extensionsToTreatAsEsm: [".ts"],
  moduleNameMapper: {
    "^(\\.{1,2}/.*)\\.js$": "$1",
  },
  transform: {
    "^.+\\.tsx?$": [
      "ts-jest",
      {
        useESM: true,
        tsconfig: {
          target: "ES2022",
          module: "ESNext",
          types: ["node", "jest"],
          esModuleInterop: true,
          allowSyntheticDefaultImports: true,
        },
      },
    ],
  },
  testMatch: ["**/__tests__/**/*.test.ts", "**/*.test.ts"],
  testPathIgnorePatterns: [
    // T-013/T-016 use real knowledge files (../knowledge/*.jsonl) unavailable in Stryker sandbox
    "src/__tests__/T-013.test.ts",
    "src/__tests__/T-016.test.ts",
  ],
  modulePathIgnorePatterns: ["<rootDir>/dist/"],
};
