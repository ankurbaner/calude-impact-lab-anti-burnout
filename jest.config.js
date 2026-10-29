/** @type {import('ts-jest').JestConfigWithTsJest} */
module.exports = {
  preset: "ts-jest",
  testEnvironment: "node",
  roots: ["<rootDir>/tests"],
  testMatch: ["**/*.test.ts"],
  // The tracker/content logic under test is pure and Electron-free, so we
  // compile only those sources rather than the whole main process.
  transform: {
    "^.+\\.ts$": ["ts-jest", { tsconfig: { noUnusedLocals: false, noUnusedParameters: false } }],
  },
};
