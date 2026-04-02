import baseConfig from "./jest.config.mjs";

export default {
  ...baseConfig,
  collectCoverage: true,
  coverageDirectory: "coverage/full",
  coverageReporters: ["text", "lcov", "json-summary"],
  coverageThreshold: {},
  collectCoverageFrom: [
    "src/**/*.js",
    "scripts/**/*.js",
    "scripts/check-coverage.mjs",
  ],
};
