import { createRequire } from "module";
const require = createRequire(import.meta.url);
const { version } = require("../package.json");

import {
  jest,
  describe,
  test,
  expect,
  beforeAll,
  afterAll,
} from "@jest/globals";

jest.unstable_mockModule("apify", async () => {
  const { apifyMock } = await import("./helpers/shared-mocks.js");
  return { Actor: apifyMock };
});

const request = (await import("supertest")).default;
const { app, initialize, shutdown } = await import("../src/main.js");

describe("UI & Landing Page Tests", () => {
  beforeAll(async () => {
    await initialize();
  });

  afterAll(async () => {
    await shutdown("TEST_COMPLETE");
  });

  test("GET / should return professional HTML landing page for browsers", async () => {
    const res = await request(app).get("/").set("Accept", "text/html");

    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toContain("text/html");
    expect(res.text).toContain("Webhook Debugger");
    expect(res.text).toContain(`v${version}`);
    expect(res.text).toContain("System Online");
  });

  test("GET / should return plain text for non-browser clients", async () => {
    const res = await request(app).get("/").set("Accept", "text/plain");

    expect(res.statusCode).toBe(200);
    expect(res.text).toContain("Enterprise Suite");
    expect(res.text).not.toContain("<!DOCTYPE html>");
  });

  test("Readiness probe should return 200 OK", async () => {
    const res = await request(app)
      .get("/")
      .set("x-apify-container-server-readiness-probe", "1");

    expect(res.statusCode).toBe(200);
    expect(res.text).toBe("OK");
  });
});
