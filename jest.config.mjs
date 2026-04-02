export default {
  transform: {},
  coveragePathIgnorePatterns: [
    "/node_modules/",
    "/tests/setup/",
    "/tests/fixtures/",
    "/tests/manual/",
  ],
  coverageThreshold: {
    global: {
      branches: 90,
      functions: 90,
      lines: 90,
      statements: 90,
    },
  },
  setupFiles: ["./tests/setup/env.js"],
  watchman: false,
};
