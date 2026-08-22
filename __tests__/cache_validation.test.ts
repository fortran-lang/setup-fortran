import * as cache from "@actions/cache";
import * as core from "@actions/core";
import * as exec from "@actions/exec";
import * as fs from "fs";
import {
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
    expect(core.warning).toHaveBeenCalledWith(
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

  it("does not fail an installation when cache saving is unavailable", async () => {
    (
      cache.saveCache as jest.MockedFunction<typeof cache.saveCache>
    ).mockRejectedValue(new Error("immutable cache already exists"));

    await expect(
      saveCompilerCache(["/compiler"], "key"),
    ).resolves.toBeUndefined();
    expect(core.warning).toHaveBeenCalledWith(
      expect.stringContaining("immutable cache already exists"),
    );
  });
});
