import { jest } from "@jest/globals";

const mockAccess = /** @type {jest.Mock<any>} */ (jest.fn());
const mockMkdir = /** @type {jest.Mock<any>} */ (jest.fn());
const mockWriteFile = /** @type {jest.Mock<any>} */ (jest.fn());
const mockReadFile = /** @type {jest.Mock<any>} */ (jest.fn());

// Must be called before importing the module under test
jest.unstable_mockModule("fs/promises", () => ({
  access: mockAccess,
  mkdir: mockMkdir,
  writeFile: mockWriteFile,
  readFile: mockReadFile,
  default: {
    access: mockAccess,
    mkdir: mockMkdir,
    writeFile: mockWriteFile,
    readFile: mockReadFile,
  },
}));

// Dynamic import required for ESM mocking to take effect
const { ensureLocalInputExists } = await import("../src/utils/bootstrap.js");

describe("bootstrap.js", () => {
  const consoleWarnSpy = jest
    .spyOn(console, "warn")
    .mockImplementation(() => {});
  const consoleLogSpy = jest.spyOn(console, "log").mockImplementation(() => {});

  beforeEach(() => {
    jest.clearAllMocks();
    process.env.APIFY_LOCAL_STORAGE_DIR = "/tmp/test-storage";
  });

  afterEach(() => {
    delete process.env.APIFY_LOCAL_STORAGE_DIR;
  });

  afterAll(() => {
    jest.restoreAllMocks();
  });

  test("should check if INPUT.json exists", async () => {
    // Setup: file exists
    mockAccess.mockResolvedValue(undefined);
    mockReadFile.mockResolvedValue('{"valid": true}');

    await ensureLocalInputExists({ urlCount: 1 });

    expect(mockAccess).toHaveBeenCalledWith(
      expect.stringContaining("INPUT.json")
    );
    // Should NOT write
    expect(mockWriteFile).not.toHaveBeenCalled();
  });

  test("should create file from schema defaults if missing (ENOENT)", async () => {
    // Setup: INPUT.json missing
    const enoent = /** @type {NodeJS.ErrnoException} */ (
      new Error("File not found")
    );
    enoent.code = "ENOENT";
    mockAccess.mockRejectedValue(enoent);
    mockMkdir.mockResolvedValue(undefined);
    mockWriteFile.mockResolvedValue(undefined);

    // Setup: Schema exists
    const mockSchema = {
      properties: {
        urlCount: { default: 3 },
        retentionHours: { prefill: 48 }, // Prefill wins
        apiSecret: { type: "string" }, // No default
        section_debug: { editor: "hidden", type: "string" },
        internalFlag: { editor: "hidden", default: true },
      },
    };
    mockReadFile.mockImplementation(async (/** @type {any} */ filePath) => {
      const pathStr = filePath.toString();
      if (pathStr.includes("input_schema.json")) {
        return JSON.stringify(mockSchema);
      }
      throw enoent; // INPUT.json missing
    });

    await ensureLocalInputExists({ someOverride: 999 });

    expect(mockWriteFile).toHaveBeenCalledWith(
      expect.stringContaining("INPUT.json"),
      expect.stringContaining('"urlCount": 3'),
      "utf-8"
    );
    expect(mockWriteFile).toHaveBeenCalledWith(
      expect.stringContaining("INPUT.json"),
      expect.stringContaining('"retentionHours": 48'),
      "utf-8"
    );

    // Override should still be present
    expect(mockWriteFile).toHaveBeenCalledWith(
      expect.stringContaining("INPUT.json"),
      expect.stringContaining('"someOverride": 999'),
      "utf-8"
    );

    // Hidden fields should be absent
    expect(mockWriteFile).toHaveBeenCalledWith(
      expect.stringContaining("INPUT.json"),
      expect.not.stringContaining("section_debug"),
      "utf-8"
    );
    expect(mockWriteFile).toHaveBeenCalledWith(
      expect.stringContaining("INPUT.json"),
      expect.not.stringContaining("internalFlag"),
      "utf-8"
    );
  });

  test("should catch write errors gracefully", async () => {
    // Setup: access throws ENOENT, but write throws EACCES
    const enoent = /** @type {NodeJS.ErrnoException} */ (
      new Error("File not found")
    );
    enoent.code = "ENOENT";
    mockAccess.mockRejectedValue(enoent);
    mockMkdir.mockResolvedValue(undefined);

    const writeError = new Error("Permission denied");
    mockWriteFile.mockRejectedValue(writeError);

    // Mock schema read to isolate the write error test
    mockReadFile.mockResolvedValue(JSON.stringify({ properties: {} }));

    await ensureLocalInputExists({});

    expect(consoleWarnSpy).toHaveBeenCalledWith(
      expect.stringContaining("Failed to write default input file"),
      expect.any(String)
    );
  });

  test("should recover from invalid INPUT.json (corrupt file)", async () => {
    // Setup: file exists but has invalid JSON
    mockAccess.mockResolvedValue(undefined);
    mockWriteFile.mockResolvedValue(undefined);

    // Initial read returns bad JSON
    mockReadFile.mockImplementation(async (/** @type {any} */ filePath) => {
      const pathStr = filePath.toString();
      if (pathStr.includes("input_schema.json")) {
        return JSON.stringify({ properties: { urlCount: { default: 10 } } });
      }
      if (pathStr.includes("INPUT.json")) {
        return "{ invalid json ";
      }
      return "";
    });

    await ensureLocalInputExists({ extra: 1 });

    // Should read file
    expect(mockReadFile).toHaveBeenCalledWith(
      expect.stringContaining("INPUT.json"),
      "utf-8"
    );

    // Should rewrite with defaults from schema
    expect(mockWriteFile).toHaveBeenCalledWith(
      expect.stringContaining("INPUT.json"),
      expect.stringContaining('"urlCount": 10'),
      "utf-8"
    );

    expect(consoleWarnSpy).toHaveBeenCalledWith(
      expect.stringContaining(
        "INPUT.json was invalid; rewritten with defaults"
      ),
      expect.any(String)
    );
  });

  test("should not overwrite file on read error", async () => {
    mockAccess.mockResolvedValue(undefined);
    const readError = /** @type {NodeJS.ErrnoException} */ (
      new Error("Permission denied")
    );
    readError.code = "EACCES";
    mockReadFile.mockRejectedValue(readError);

    await ensureLocalInputExists({ urlCount: 5 });

    // Should NOT attempt to rewrite on read errors
    expect(mockWriteFile).not.toHaveBeenCalled();
    expect(consoleWarnSpy).toHaveBeenCalledWith(
      expect.stringContaining("Failed to read INPUT.json"),
      expect.any(String)
    );
  });
});
