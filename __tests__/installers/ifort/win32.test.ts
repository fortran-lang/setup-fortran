import * as core from "@actions/core";
import * as exec from "@actions/exec";
import * as cache from "@actions/cache";
import * as tc from "@actions/tool-cache";
import * as fs from "fs";
import { installWin32 } from "../../../src/installers/ifort/win32";
import { Arch, Compiler, OS, Msystem, type Inputs } from "../../../src/types";

jest.mock("@actions/core");
jest.mock("@actions/exec");
jest.mock("@actions/cache");
jest.mock("@actions/tool-cache");
jest.mock("../../../src/verify_download");
jest.mock("fs", () => ({
  ...jest.requireActual("fs"),
  writeFileSync: jest.fn(),
  existsSync: jest.fn(),
  mkdirSync: jest.fn(),
  rmSync: jest.fn(),
}));

describe("installWin32 (ifort)", () => {
  const mockedExec = exec.exec as jest.MockedFunction<typeof exec.exec>;
  const mockedCache = cache as jest.Mocked<typeof cache>;
  const mockedTc = tc as jest.Mocked<typeof tc>;
  const mockedFs = fs as jest.Mocked<typeof fs>;
  const mockedExportVariable = core.exportVariable as jest.MockedFunction<
    typeof core.exportVariable
  >;

  const baseInputs: Inputs = {
    compiler: Compiler.IFort,
    version: "2021.10",
    os: OS.Windows,
    osVersion: "2022",
    arch: Arch.X64,
    cleanupDisk: false,
    updateEnvironment: true,
    msystem: Msystem.Native,
  };

  beforeEach(() => {
    jest.clearAllMocks();
    mockedFs.existsSync.mockReturnValue(true);
    mockedExec.mockImplementation(async (commandLine, args, options) => {
      if (commandLine === "ifort" && args?.[0] === "/what") {
        if (options?.listeners?.stdout) {
          options.listeners.stdout(
            Buffer.from(
              "Intel(R) Fortran Intel(R) 64 Compiler Classic for applications running on Intel(R) 64, Version 2021.10.0 Build 20230609",
            ),
          );
        }
      }
      if (
        commandLine === "cmd" &&
        args?.[1]?.includes("setvars_ifort_dump.bat")
      ) {
        if (options?.listeners?.stdout) {
          options.listeners.stdout(
            Buffer.from(
              "PATH=C:\\Program Files (x86)\\Intel\\oneAPI\\compiler\\latest\\windows\\bin\nONEAPI_ROOT=C:\\Program Files (x86)\\Intel\\oneAPI",
            ),
          );
        }
      }
      return 0;
    });
  });

  it("restores from cache if available", async () => {
    mockedCache.restoreCache.mockResolvedValue("hit");

    await installWin32(baseInputs);

    expect(mockedCache.restoreCache).toHaveBeenCalled();
    expect(mockedTc.downloadTool).not.toHaveBeenCalled();
  });

  it("downloads and installs if cache is missing", async () => {
    mockedCache.restoreCache.mockResolvedValue(undefined);
    mockedTc.downloadTool.mockResolvedValue("C:\\Temp\\ifort.exe");

    await installWin32(baseInputs);

    expect(mockedTc.downloadTool).toHaveBeenCalled();
    expect(mockedExec).toHaveBeenCalledWith('"C:\\Temp\\ifort.exe"', [
      "-s",
      "-a",
      "--silent",
      "--eula",
      "accept",
      "-p=NEED_VS2019_INTEGRATION=0",
      "-p=NEED_VS2022_INTEGRATION=0",
    ]);
    expect(mockedCache.saveCache).toHaveBeenCalled();
  });

  it("exports environment variables", async () => {
    mockedCache.restoreCache.mockResolvedValue("hit");

    await installWin32(baseInputs);

    expect(mockedExportVariable).toHaveBeenCalledWith(
      "ONEAPI_ROOT",
      "C:\\Program Files (x86)\\Intel\\oneAPI",
    );
    expect(mockedExportVariable).toHaveBeenCalledWith(
      "PATH",
      "C:\\Program Files (x86)\\Intel\\oneAPI\\compiler\\latest\\windows\\bin",
    );
  });

  it("resolves and returns the installed version", async () => {
    mockedCache.restoreCache.mockResolvedValue("hit");
    const result = await installWin32(baseInputs);
    expect(result).toMatchObject({
      fc: "ifort",
      cc: "cl",
      cxx: "cl",
    });
    expect(result.version).toContain(
      "Intel(R) Fortran Intel(R) 64 Compiler Classic",
    );
  });

  it("dedupes PATH entries case-insensitively before exporting", async () => {
    mockedCache.restoreCache.mockResolvedValue("hit");
    mockedExec.mockImplementation(async (commandLine, args, options) => {
      if (
        commandLine === "cmd" &&
        args?.[1]?.includes("setvars_ifort_dump.bat")
      ) {
        if (options?.listeners?.stdout) {
          options.listeners.stdout(
            Buffer.from(
              "PATH=C:\\Intel\\bin;C:\\MSVC\\bin;C:\\intel\\BIN;;C:\\MSVC\\bin",
            ),
          );
        }
      }
      return 0;
    });

    await installWin32(baseInputs);

    expect(mockedExportVariable).toHaveBeenCalledWith(
      "PATH",
      "C:\\Intel\\bin;C:\\MSVC\\bin",
    );
  });

  describe("download retry", () => {
    afterEach(() => {
      jest.useRealTimers();
    });

    it("retries a failed download, removes the partial file, and succeeds", async () => {
      mockedCache.restoreCache.mockResolvedValue(undefined);
      mockedTc.downloadTool
        .mockRejectedValueOnce(new Error("connection reset"))
        .mockResolvedValue("C:\\Temp\\ifort.exe");

      jest.useFakeTimers();
      const installPromise = installWin32(baseInputs);

      for (let i = 0; i < 10; i++) await Promise.resolve();
      expect(mockedTc.downloadTool).toHaveBeenCalledTimes(1);

      // Advance past the 20s backoff after the first failure.
      jest.advanceTimersByTime(20_000);
      for (let i = 0; i < 10; i++) await Promise.resolve();

      await installPromise;

      expect(mockedTc.downloadTool).toHaveBeenCalledTimes(2);
      expect(core.info).toHaveBeenCalledWith(
        expect.stringContaining("Download failed (attempt 1/3)"),
      );
      expect(mockedFs.rmSync).toHaveBeenCalledWith(
        expect.stringContaining("ifort-2021.10.exe"),
        { force: true },
      );
      expect(mockedCache.saveCache).toHaveBeenCalled();
    });

    it("gives up after three attempts and propagates the last error", async () => {
      mockedCache.restoreCache.mockResolvedValue(undefined);
      mockedTc.downloadTool.mockRejectedValue(new Error("network down"));

      jest.useFakeTimers();
      const installPromise = installWin32(baseInputs);

      for (let i = 0; i < 10; i++) await Promise.resolve();
      jest.advanceTimersByTime(20_000); // backoff after attempt 1
      for (let i = 0; i < 10; i++) await Promise.resolve();
      jest.advanceTimersByTime(40_000); // backoff after attempt 2
      for (let i = 0; i < 10; i++) await Promise.resolve();

      await expect(installPromise).rejects.toThrow("network down");

      expect(mockedTc.downloadTool).toHaveBeenCalledTimes(3);
      expect(mockedFs.rmSync).toHaveBeenCalledTimes(3);
      expect(core.info).toHaveBeenCalledWith(
        expect.stringContaining("Download failed (attempt 1/3)"),
      );
      expect(core.info).toHaveBeenCalledWith(
        expect.stringContaining("Download failed (attempt 2/3)"),
      );
      expect(mockedCache.saveCache).not.toHaveBeenCalled();
    });
  });
});
