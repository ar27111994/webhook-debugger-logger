import baseConfig from "./jest.config.mjs";

export default {
  ...baseConfig,
  collectCoverage: true,
  coverageDirectory: "coverage/new-scopes",
  coverageReporters: ["text", "lcov", "json-summary"],
  coverageThreshold: {},
  collectCoverageFrom: [
    "src/main.js",
    "src/logger_middleware.js",
    "src/routes/**/*.js",
  ],
};
