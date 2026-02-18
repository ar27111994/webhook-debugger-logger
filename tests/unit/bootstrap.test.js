import { jest, describe, test, expect, beforeEach } from "@jest/globals";
import { assertType } from "../setup/helpers/test-utils.js";

// 1. Setup Common Mocks FIRST
import { setupCommonMocks } from "../setup/helpers/mock-setup.js";
import {
  fsPromisesMock as mockFs,
  loggerMock,
} from "../setup/helpers/shared-mocks.js";
import {
  FILE_EXTENSIONS,
  FILE_NAMES,
  STORAGE_CONSTS,
} from "../../src/consts/storage.js";
import { LOG_MESSAGES } from "../../src/consts/messages.js";
import { ENV_VARS } from "../../src/consts/app.js";
import { ENCODINGS } from "../../src/consts/http.js";

await setupCommonMocks({ logger: true, fs: true });

// 2. Import module under test dynamically
const bootstrap = await import(`../../src/utils/bootstrap.js?t=${Date.now()}`);

// 3. Import lifecycle helpers
const { useMockCleanup } = await import("../setup/helpers/test-lifecycle.js");

/**
 * @typedef {import("../../src/typedefs.js").CommonError} CommonError
 */

describe("Bootstrap Utilities", () => {
  useMockCleanup();

  const mockInput = { some: "default" };
  const mockSchema = {
    properties: {
      urlCount: { default: 1 },
      secret: { prefill: "secret-value" },
      hiddenField: { editor: "hidden", default: "hidden" },
      other: { type: "string" }, // No default/prefill
    },
  };

  beforeEach(() => {
    jest.clearAllMocks();
    process.env[ENV_VARS.APIFY_LOCAL_STORAGE_DIR] = STORAGE_CONSTS.TEMP_STORAGE;
    delete process.env[ENV_VARS.APIFY_ACTOR_DIR];
  });

  afterEach(() => {
    delete process.env[ENV_VARS.APIFY_LOCAL_STORAGE_DIR];
    delete process.env[ENV_VARS.APIFY_ACTOR_DIR];
  });

  describe("ensureLocalInputExists", () => {
    test("should do nothing if INPUT.json already exists and is valid", async () => {
      mockFs.access.mockResolvedValue(assertType(undefined)); // File exists
      mockFs.readFile.mockResolvedValue(
        assertType(JSON.stringify({ existing: true })),
      ); // Valid JSON

      await bootstrap.ensureLocalInputExists(mockInput);

      expect(mockFs.access).toHaveBeenCalled();
      expect(mockFs.readFile).toHaveBeenCalled();
      expect(mockFs.writeFile).not.toHaveBeenCalled();
    });

    test("should create INPUT.json with defaults if it does not exist", async () => {
      /** @type {CommonError} */
      const error = new Error("ENOENT");
      error.code = "ENOENT";
      mockFs.access.mockRejectedValue(assertType(error));

      // Mock schema reading for defaults
      mockFs.readFile.mockResolvedValueOnce(
        assertType(JSON.stringify(mockSchema)),
      ); // Schema read

      await bootstrap.ensureLocalInputExists(mockInput);

      expect(mockFs.mkdir).toHaveBeenCalledWith(expect.any(String), {
        recursive: true,
      });
      // Should write merged config (defaults from schema + passed defaultInput)
      expect(mockFs.writeFile).toHaveBeenCalledWith(
        expect.stringContaining(FILE_NAMES.CONFIG + FILE_EXTENSIONS.TMP),
        expect.stringContaining('"urlCount": 1'),
        ENCODINGS.UTF8,
      );
      expect(mockFs.writeFile).toHaveBeenCalledWith(
        expect.stringContaining(FILE_NAMES.CONFIG + FILE_EXTENSIONS.TMP),
        expect.stringContaining('"secret": "secret-value"'), // Prefill priority
        ENCODINGS.UTF8,
      );
      expect(mockFs.rename).toHaveBeenCalled();
      expect(loggerMock.info).toHaveBeenCalledWith(
        expect.any(Object),
        LOG_MESSAGES.LOCAL_CONFIG_INIT,
      );
    });

    test("should rewrite INPUT.json if it contains invalid JSON", async () => {
      mockFs.access.mockResolvedValue(assertType(undefined)); // File exists
      mockFs.readFile
        .mockResolvedValueOnce(assertType("{ invalid json }")) // Invalid content
        .mockResolvedValueOnce(assertType(JSON.stringify(mockSchema))); // Schema read for defaults

      await bootstrap.ensureLocalInputExists(mockInput);

      expect(mockFs.writeFile).toHaveBeenCalled();
      expect(mockFs.rename).toHaveBeenCalled(); // Should rename tmp to original
      expect(loggerMock.warn).toHaveBeenCalledWith(
        expect.objectContaining({ err: expect.any(Object) }),
        LOG_MESSAGES.INPUT_INVALID_REWRITTEN,
      );
    });

    test("should log warning if file exists but read fails with non-syntax error", async () => {
      mockFs.access.mockResolvedValue(assertType(undefined));
      mockFs.readFile.mockRejectedValue(
        assertType(new Error("Permission denied")),
      );

      await bootstrap.ensureLocalInputExists(mockInput);

      expect(mockFs.writeFile).not.toHaveBeenCalled();
      expect(loggerMock.warn).toHaveBeenCalledWith(
        expect.objectContaining({ err: expect.any(Object) }),
        LOG_MESSAGES.INPUT_ACCESS_ERROR,
      );
    });

    test("should handle write errors gracefully when creating new file", async () => {
      /** @type {CommonError} */
      const error = new Error("ENOENT");
      error.code = "ENOENT";
      mockFs.access.mockRejectedValue(assertType(error));
      mockFs.readFile.mockResolvedValue(assertType(JSON.stringify(mockSchema)));
      mockFs.writeFile.mockRejectedValueOnce(
        assertType(new Error("Write failed")),
      );

      await bootstrap.ensureLocalInputExists(mockInput);

      expect(loggerMock.warn).toHaveBeenCalledWith(
        expect.objectContaining({ err: expect.any(Object) }),
        LOG_MESSAGES.DEFAULT_INPUT_WRITE_FAILED,
      );
    });

    test("should cleanup temp file if rename fails during creation", async () => {
      // Force individual implementation to ensure it rejects as expected
      mockFs.rename.mockImplementationOnce(() =>
        Promise.reject(new Error("Rename failed")),
      );

      // Re-import to ensure fresh binding
      const bootstrapRe = await import(
        `../../src/utils/bootstrap.js?t=${Date.now()}_reimport`
      );

      /** @type {CommonError} */
      const error = new Error("ENOENT");
      error.code = "ENOENT";
      mockFs.access.mockRejectedValue(assertType(error));
      mockFs.readFile.mockResolvedValue(assertType(JSON.stringify(mockSchema)));

      // Logic expects it to swallow the error and log a warning
      await bootstrapRe.ensureLocalInputExists(mockInput);

      // Verify rm was called for cleanup (twice: once for target, once for tmp on error)
      const rmCalls = 2;
      expect(mockFs.rm).toHaveBeenCalledTimes(rmCalls);
      expect(mockFs.rm).toHaveBeenCalledWith(
        expect.stringContaining(FILE_EXTENSIONS.TMP),
        expect.any(Object),
      );

      // Verify it logged the warning about failing to write
      expect(loggerMock.warn).toHaveBeenCalledWith(
        expect.objectContaining({
          err: expect.objectContaining({ message: "Rename failed" }),
        }),
        LOG_MESSAGES.DEFAULT_INPUT_WRITE_FAILED,
      );
    });

    test("should log warning if access fails with unexpected non-ENOENT error", async () => {
      mockFs.access.mockRejectedValue(assertType(new Error("EPERM")));

      await bootstrap.ensureLocalInputExists(mockInput);

      expect(loggerMock.warn).toHaveBeenCalledWith(
        expect.objectContaining({ err: expect.any(Object) }),
        LOG_MESSAGES.INPUT_ACCESS_ERROR,
      );
    });
  });

  describe("getDefaultsFromSchema", () => {
    test("should return empty object if no schema file exists", async () => {
      mockFs.readFile.mockRejectedValue(assertType(new Error("ENOENT"))); // Simulate file not found
      const defaults = await bootstrap.getDefaultsFromSchema();
      expect(defaults).toEqual({});
    });

    test("should use APIFY_ACTOR_DIR for schema path if set", async () => {
      process.env[ENV_VARS.APIFY_ACTOR_DIR] = "/custom/actor/dir";
      const mockSchema = {
        title: "Custom Path Schema",
        type: "object",
        properties: {},
      };

      mockFs.readFile.mockResolvedValue(assertType(JSON.stringify(mockSchema)));

      // Re-import to trigger the path logic again (though usually only needed if it was top-level)
      // Here we just testing the function behavior which reads the env var inside.
      const bootstrapRe = await import(
        `../../src/utils/bootstrap.js?t=${Date.now()}_custom_path`
      );

      await bootstrapRe.getDefaultsFromSchema();

      expect(mockFs.readFile).toHaveBeenCalledWith(
        expect.stringContaining("/custom/actor/dir/.actor/input_schema.json"),
        ENCODINGS.UTF8,
      );
      delete process.env[ENV_VARS.APIFY_ACTOR_DIR];
    });

    test("should handle schema read failure gracefully", async () => {
      /** @type {CommonError} */
      const error = new Error("ENOENT");
      error.code = "ENOENT";
      mockFs.access.mockRejectedValue(assertType(error));
      mockFs.readFile.mockRejectedValue(
        assertType(new Error("Schema not found")),
      );

      await bootstrap.ensureLocalInputExists(assertType(mockInput));

      // Should still try to write file, just without schema defaults
      expect(mockFs.writeFile).toHaveBeenCalledWith(
        expect.any(String),
        expect.stringContaining('"some": "default"'),
        ENCODINGS.UTF8,
      );
    });
  });
});
