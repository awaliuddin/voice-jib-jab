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
  collectCoverageFrom: ["src/**/*.ts", "!src/**/*.d.ts", "!src/index.ts"],
  modulePathIgnorePatterns: ["<rootDir>/dist/"],
  coverageThreshold: {
    global: {
      // Floors set ~3% below actual (2026-03-12): stmt 91%, branch 81.5%, fn 90%, lines 91.3%
      statements: 88,
      branches: 78,
      functions: 87,
      lines: 88,
    },
  },
};
