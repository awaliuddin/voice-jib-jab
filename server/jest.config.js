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
  collectCoverageFrom: [
    "src/**/*.ts",
    "!src/**/*.d.ts",          // OMIT JUSTIFIED: type declarations, no runtime code
    "!src/index.ts",           // OMIT JUSTIFIED: server entrypoint — app.listen() wiring only, no business logic
    "!src/demo/run.ts",        // OMIT JUSTIFIED: demo script entrypoint, dev-only
  ],
  modulePathIgnorePatterns: ["<rootDir>/dist/", "<rootDir>/.stryker-tmp/"],
  testPathIgnorePatterns: ["/node_modules/", "<rootDir>/dist/", "<rootDir>/.stryker-tmp/", "/.claude/worktrees/"],
  coverageThreshold: {
    global: {
      // Floors set ~3% below actual (2026-03-25 CRUCIBLE): stmt 97.25%, branch 92.62%, fn 96.65%, lines 97.49%
      statements: 94,
      branches: 90,
      functions: 93,
      lines: 94,
    },
  },
};
