/**
 * @file tests/unit/utils/bootstrap.test.js
 * @description Unit tests for bootstrap utilities.
 */

import { describe, it, expect, beforeEach } from "@jest/globals";
import { setupCommonMocks } from "../../setup/helpers/mock-setup.js";
import { useMockCleanup } from "../../setup/helpers/test-lifecycle.js";
import { FILE_EXTENSIONS } from "../../../src/consts/storage.js";

/**
 * @typedef {import("../../../src/typedefs.js").CommonError} CommonError
 */

await setupCommonMocks({
    fs: true,
    logger: true,
    consts: true
});

const { fsPromisesMock, loggerMock } = await import("../../setup/helpers/shared-mocks.js");
const { ensureLocalInputExists, getDefaultsFromSchema } = await import("../../../src/utils/bootstrap.js");
const { SCHEMA_KEYS } = await import("../../../src/consts/storage.js");
const { NODE_ERROR_CODES } = await import("../../../src/consts/errors.js");
const { ENV_VARS } = await import("../../../src/consts/app.js");
const { ENCODINGS } = await import("../../../src/consts/http.js");
const { LOG_MESSAGES } = await import("../../../src/consts/messages.js");

describe("bootstrap utils", () => {
    useMockCleanup();

    const mockDefaultInput = { urlCount: 50 };

    describe("ensureLocalInputExists()", () => {
        beforeEach(() => {
            // Default mock for successful file access
            fsPromisesMock.access.mockResolvedValue(undefined);
            fsPromisesMock.readFile.mockResolvedValue(JSON.stringify({ existing: true }));
            fsPromisesMock.writeFile.mockResolvedValue(undefined);
            fsPromisesMock.mkdir.mockResolvedValue(undefined);
            fsPromisesMock.rename.mockResolvedValue(undefined);
            fsPromisesMock.rm.mockResolvedValue(undefined);
        });

        it("should do nothing if valid local input file exists", async () => {
            await ensureLocalInputExists(mockDefaultInput);
            expect(fsPromisesMock.access).toHaveBeenCalled();
            expect(fsPromisesMock.readFile).toHaveBeenCalled();
            expect(fsPromisesMock.writeFile).not.toHaveBeenCalled();
        });

        it("should rewrite file if JSON is corrupt (SyntaxError)", async () => {
            fsPromisesMock.readFile.mockResolvedValue("invalid json");

            await ensureLocalInputExists(mockDefaultInput);

            expect(fsPromisesMock.writeFile).toHaveBeenCalledWith(
                expect.stringContaining(FILE_EXTENSIONS.TMP),
                expect.stringContaining(`"urlCount": ${mockDefaultInput.urlCount}`),
                ENCODINGS.UTF8
            );
            expect(fsPromisesMock.rename).toHaveBeenCalled();
            expect(loggerMock.warn).toHaveBeenCalledWith(
                expect.objectContaining({ err: expect.any(Object) }),
                LOG_MESSAGES.INPUT_INVALID_REWRITTEN
            );
        });

        it("should log error if file exists but read fails with non-SyntaxError", async () => {
            const fsErr = new Error("Permission Denied");
            fsPromisesMock.readFile.mockRejectedValue(fsErr);

            await ensureLocalInputExists(mockDefaultInput);

            expect(loggerMock.warn).toHaveBeenCalledWith(
                expect.objectContaining({ err: expect.any(Object) }),
                LOG_MESSAGES.INPUT_ACCESS_ERROR
            );
        });

        it("should create directory and file if it does not exist (ENOENT)", async () => {
            /** @type {CommonError} */
            const enoent = new Error("Not found");
            enoent.code = NODE_ERROR_CODES.ENOENT;
            fsPromisesMock.access.mockRejectedValue(enoent);

            await ensureLocalInputExists(mockDefaultInput);

            expect(fsPromisesMock.mkdir).toHaveBeenCalled();
            expect(fsPromisesMock.writeFile).toHaveBeenCalled();
            expect(fsPromisesMock.rename).toHaveBeenCalled();
            expect(loggerMock.info).toHaveBeenCalledWith(
                expect.anything(),
                LOG_MESSAGES.LOCAL_CONFIG_INIT
            );
        });

        it("should handle failed creation gracefully if mkdir fails", async () => {
            /** @type {CommonError} */
            const enoent = new Error("Not found");
            enoent.code = NODE_ERROR_CODES.ENOENT;
            fsPromisesMock.access.mockRejectedValue(enoent);
            fsPromisesMock.mkdir.mockRejectedValue(new Error("Disk Full"));

            await ensureLocalInputExists(mockDefaultInput);

            expect(loggerMock.warn).toHaveBeenCalledWith(
                expect.any(Object),
                LOG_MESSAGES.DEFAULT_INPUT_WRITE_FAILED
            );
        });

        it("should clean up tmp file and throw if rename fails during init", async () => {
            /** @type {CommonError} */
            const enoent = new Error("Not found");
            /** @type {CommonError} */
            const renameErr = new Error("Rename Failed");
            enoent.code = NODE_ERROR_CODES.ENOENT;
            fsPromisesMock.access.mockRejectedValue(enoent);
            fsPromisesMock.rename.mockRejectedValue(renameErr);

            await ensureLocalInputExists(mockDefaultInput);

            // It should have called rm for the tmp file in the catch block
            const expectedRmCalls = 2;
            expect(fsPromisesMock.rm).toHaveBeenCalledTimes(expectedRmCalls); // Once for inputPath, once for tmpPath
            expect(loggerMock.warn).toHaveBeenCalledWith(
                expect.any(Object),
                LOG_MESSAGES.DEFAULT_INPUT_WRITE_FAILED
            );
        });

        it("should log access error if fs.access fails with non-ENOENT", async () => {
            /** @type {CommonError} */
            const otherErr = new Error("Locked");
            otherErr.code = "EBUSY";
            fsPromisesMock.access.mockRejectedValue(otherErr);

            await ensureLocalInputExists(mockDefaultInput);

            expect(loggerMock.warn).toHaveBeenCalledWith(
                expect.objectContaining({ err: expect.any(Object) }),
                LOG_MESSAGES.INPUT_ACCESS_ERROR
            );
        });
    });

    describe("getDefaultsFromSchema()", () => {
        const mockSchema = {
            properties: {
                fieldA: { default: "valA" },
                fieldB: { prefill: "valB" },
                fieldC: { default: "defC", prefill: "prefC" }, // Prefill wins
                fieldD: { editor: SCHEMA_KEYS.EDITOR_HIDDEN, default: "secret" }, // Hidden skipped
                [`${SCHEMA_KEYS.SECTION_PREFIX}Header`]: { default: "section" }, // Section skipped
                fieldE: {} // Neither prefill nor default, branch coverage
            }
        };

        beforeEach(() => {
            delete process.env[ENV_VARS.APIFY_ACTOR_DIR];
            fsPromisesMock.readFile.mockResolvedValue(JSON.stringify(mockSchema));
        });

        it("should extract defaults and prefills with prefill priority", async () => {
            const result = await getDefaultsFromSchema();
            expect(result).toEqual({
                fieldA: "valA",
                fieldB: "valB",
                fieldC: "prefC"
            });
            expect(result).not.toHaveProperty("fieldD");
            expect(result).not.toHaveProperty("section-Header");
        });

        it("should use APIFY_ACTOR_DIR env var to resolve schema path", async () => {
            process.env[ENV_VARS.APIFY_ACTOR_DIR] = "/custom/dir";
            await getDefaultsFromSchema();

            expect(fsPromisesMock.readFile).toHaveBeenCalledWith(
                expect.stringContaining("/custom/dir"),
                ENCODINGS.UTF8
            );
        });

        it("should handle missing schema file gracefully", async () => {
            fsPromisesMock.readFile.mockRejectedValue(new Error("Missing"));
            const result = await getDefaultsFromSchema();
            expect(result).toEqual({});
            expect(loggerMock.warn).toHaveBeenCalledWith(
                expect.any(Object),
                LOG_MESSAGES.SCHEMA_LOAD_FAILED
            );
        });

        it("should ignore properties if schema has no properties key", async () => {
            fsPromisesMock.readFile.mockResolvedValue(JSON.stringify({}));
            const result = await getDefaultsFromSchema();
            expect(result).toEqual({});
        });

        describe("hardening (audit feedback)", () => {
            it("should handle rm failure when cleaning up tmp file during failed rename", async () => {
                /** @type {CommonError} */
                const enoent = new Error("Not found");
                enoent.code = NODE_ERROR_CODES.ENOENT;
                fsPromisesMock.access.mockRejectedValue(enoent);

                fsPromisesMock.rename.mockRejectedValue(new Error("Rename failed"));
                // The secondary rm for tmpPath cleanup fails!
                fsPromisesMock.rm.mockRejectedValue(new Error("RM failed"));

                // Should still handle it gracefully (it's in a nested try-catch in the source)
                await ensureLocalInputExists(mockDefaultInput);

                expect(loggerMock.warn).toHaveBeenCalledWith(
                    expect.any(Object),
                    LOG_MESSAGES.DEFAULT_INPUT_WRITE_FAILED
                );
            });
        });
    });
});
