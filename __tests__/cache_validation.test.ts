import * as cache from "@actions/cache";
import * as core from "@actions/core";
import * as exec from "@actions/exec";
import * as fs from "fs";
import {
  restoreCompilerCache,
  saveCompilerCache,
  validateRestoredCompilerCache,
} from "../src/cache_validation";

jest.mock("@actions/cache");
jest.mock("@actions/core");
jest.mock("@actions/exec");
jest.mock("fs", () => ({
  ...jest.requireActual("fs"),
  existsSync: jest.fn(),
}));

describe("compiler cache validation", () => {
  const mockedExec = exec.exec as jest.MockedFunction<typeof exec.exec>;
  const mockedExists = fs.existsSync as jest.MockedFunction<
    typeof fs.existsSync
  >;

  beforeEach(() => {
    jest.clearAllMocks();
    mockedExists.mockReturnValue(true);
    mockedExec.mockResolvedValue(0);
  });

  it("accepts a complete cache whose compiler runs", async () => {
    await expect(
      validateRestoredCompilerCache("compiler", ["/setup"], "tool", [
        "--version",
      ]),
    ).resolves.toBe(true);
  });

  it("rejects a cache with missing required files without running it", async () => {
    mockedExists.mockReturnValue(false);

    await expect(
      validateRestoredCompilerCache("compiler", ["/setup"], "tool", [
        "--version",
      ]),
    ).resolves.toBe(false);
    expect(mockedExec).not.toHaveBeenCalled();
    expect(core.info).toHaveBeenCalledWith(
      expect.stringContaining("missing: /setup"),
    );
  });

  it("rejects a cache whose compiler validation fails", async () => {
    mockedExec.mockResolvedValue(1);

    await expect(
      validateRestoredCompilerCache("compiler", ["/setup"], "tool", [
        "--version",
      ]),
    ).resolves.toBe(false);
  });

  it("logs the output of a failed validation", async () => {
    mockedExec.mockImplementation(async (_command, _args, options) => {
      options?.listeners?.stderr?.(Buffer.from("compiler not found"));
      return 1;
    });

    await expect(
      validateRestoredCompilerCache("compiler", ["/setup"], "tool", [
        "--version",
      ]),
    ).resolves.toBe(false);
    expect(core.info).toHaveBeenCalledWith("compiler not found");
  });

  it("does not fail an installation when cache saving is unavailable", async () => {
    (
      cache.saveCache as jest.MockedFunction<typeof cache.saveCache>
    ).mockRejectedValue(new Error("immutable cache already exists"));

    await expect(
      saveCompilerCache(true, ["/compiler"], "key"),
    ).resolves.toBeUndefined();
    expect(core.info).toHaveBeenCalledWith(
      expect.stringContaining("immutable cache already exists"),
    );
  });
});

describe("cache gating", () => {
  const mockedRestore = cache.restoreCache as jest.MockedFunction<
    typeof cache.restoreCache
  >;
  const mockedSave = cache.saveCache as jest.MockedFunction<
    typeof cache.saveCache
  >;

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("restores when caching is enabled", async () => {
    mockedRestore.mockResolvedValue("key");

    await expect(
      restoreCompilerCache(true, ["/compiler"], "key"),
    ).resolves.toBe("key");
    expect(mockedRestore).toHaveBeenCalledWith(["/compiler"], "key");
  });

  it("does not restore when caching is disabled", async () => {
    await expect(
      restoreCompilerCache(false, ["/compiler"], "key"),
    ).resolves.toBeUndefined();
    expect(mockedRestore).not.toHaveBeenCalled();
    expect(core.info).toHaveBeenCalledWith(
      "Caching disabled; skipping restore of key.",
    );
  });

  it("propagates restore errors", async () => {
    mockedRestore.mockRejectedValue(new Error("network"));

    await expect(
      restoreCompilerCache(true, ["/compiler"], "key"),
    ).rejects.toThrow("network");
  });

  it("saves when caching is enabled", async () => {
    await saveCompilerCache(true, ["/compiler"], "key");
    expect(mockedSave).toHaveBeenCalledWith(["/compiler"], "key");
  });

  it("does not save when caching is disabled", async () => {
    await saveCompilerCache(false, ["/compiler"], "key");
    expect(mockedSave).not.toHaveBeenCalled();
    expect(core.info).toHaveBeenCalledWith(
      "Caching disabled; skipping save of key.",
    );
  });
});
