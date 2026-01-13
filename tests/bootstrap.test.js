import { jest } from "@jest/globals";

const mockAccess = /** @type {jest.Mock<any>} */ (jest.fn());
const mockMkdir = /** @type {jest.Mock<any>} */ (jest.fn());
const mockWriteFile = /** @type {jest.Mock<any>} */ (jest.fn());

// Must be called before importing the module under test
jest.unstable_mockModule("fs/promises", () => ({
  access: mockAccess,
  mkdir: mockMkdir,
  writeFile: mockWriteFile,
  default: {
    access: mockAccess,
    mkdir: mockMkdir,
    writeFile: mockWriteFile,
  },
}));

// Dynamic import required for ESM mocking to take effect
const { ensureLocalInputExists } = await import("../src/utils/bootstrap.js");

describe("bootstrap.js", () => {
  const consoleLogSpy = jest.spyOn(console, "log").mockImplementation(() => {});
  const consoleWarnSpy = jest
    .spyOn(console, "warn")
    .mockImplementation(() => {});

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

    await ensureLocalInputExists({ urlCount: 1 });

    expect(mockAccess).toHaveBeenCalledWith(
      expect.stringContaining("INPUT.json")
    );
    // Should NOT write
    expect(mockWriteFile).not.toHaveBeenCalled();
  });

  test("should create file if it is missing (ENOENT)", async () => {
    // Setup: access throws ENOENT
    const enoent = /** @type {NodeJS.ErrnoException} */ (
      new Error("File not found")
    );
    enoent.code = "ENOENT";
    mockAccess.mockRejectedValue(enoent);
    mockMkdir.mockResolvedValue(undefined);
    mockWriteFile.mockResolvedValue(undefined);

    const inputs = {
      urlCount: 5,
      someOtherKey: "value",
    };

    await ensureLocalInputExists(inputs);

    // Should create dir
    expect(mockMkdir).toHaveBeenCalledWith(expect.any(String), {
      recursive: true,
    });

    // Should write file
    expect(mockWriteFile).toHaveBeenCalledWith(
      expect.stringContaining("INPUT.json"),
      expect.stringContaining('"urlCount": 5'), // Coerced
      "utf-8"
    );

    // Should pass through arbitrary input keys
    expect(mockWriteFile).toHaveBeenCalledWith(
      expect.stringContaining("INPUT.json"),
      expect.stringContaining('"someOtherKey": "value"'),
      "utf-8"
    );

    expect(consoleLogSpy).toHaveBeenCalledWith(
      expect.stringContaining("Local configuration initialized")
    );
  });

  test("should catch write errors gracefully", async () => {
    // Setup: access throws ENOENT, but write throws EACCES
    const enoent = /** @type {NodeJS.ErrnoException} */ (
      new Error("File not found")
    );
    enoent.code = "ENOENT";
    mockAccess.mockRejectedValue(enoent);

    const writeError = new Error("Permission denied");
    mockWriteFile.mockRejectedValue(writeError);

    await ensureLocalInputExists({});

    expect(consoleWarnSpy).toHaveBeenCalledWith(
      expect.stringContaining("Failed to write default input file"),
      expect.any(String)
    );
  });
});
