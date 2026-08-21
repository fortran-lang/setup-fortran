import * as core from "@actions/core";
import * as exec from "@actions/exec";
import * as cache from "@actions/cache";
import * as tc from "@actions/tool-cache";
import * as fs from "fs";
import { installDarwin } from "../../../src/installers/ifort/darwin";
import { Arch, Compiler, OS, Msystem, type Inputs } from "../../../src/types";

jest.mock("@actions/core");
jest.mock("@actions/exec");
jest.mock("@actions/cache");
jest.mock("@actions/tool-cache");
jest.mock("../../../src/verify_download");
jest.mock("fs", () => ({
  ...jest.requireActual("fs"),
  existsSync: jest.fn(),
  mkdirSync: jest.fn(),
}));

describe("installDarwin (ifort)", () => {
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
    os: OS.MacOS,
    osVersion: "13",
    arch: Arch.X64,
    cleanupDisk: false,
    updateEnvironment: true,
    msystem: Msystem.Native,
  };

  beforeEach(() => {
    jest.clearAllMocks();
    mockedFs.existsSync.mockReturnValue(true);
    mockedExec.mockImplementation(async (commandLine, args, options) => {
      if (commandLine === "ifort" && args?.[0] === "--version") {
        if (options?.listeners?.stdout) {
          options.listeners.stdout(
            Buffer.from("ifort (IFORT) 2021.10.0 20230609"),
          );
        }
      }
      if (commandLine === "bash" && args?.[1]?.includes("setvars.sh")) {
        if (options?.listeners?.stdout) {
          options.listeners.stdout(
            Buffer.from(
              "PATH=/opt/intel/oneapi/compiler/latest/bin\nONEAPI_ROOT=/opt/intel/oneapi",
            ),
          );
        }
      }
      return 0;
    });
  });

  it("restores from cache if available", async () => {
    mockedCache.restoreCache.mockResolvedValue("hit");

    await installDarwin(baseInputs);

    expect(mockedCache.restoreCache).toHaveBeenCalled();
    expect(mockedTc.downloadTool).not.toHaveBeenCalled();
  });

  it("downloads and installs if cache is missing", async () => {
    mockedCache.restoreCache.mockResolvedValue(undefined);
    mockedTc.downloadTool.mockResolvedValue("/tmp/ifort.dmg");

    await installDarwin(baseInputs);

    expect(mockedTc.downloadTool).toHaveBeenCalled();
    expect(mockedExec).toHaveBeenCalledWith("hdiutil", [
      "attach",
      "/tmp/ifort.dmg",
      "-mountpoint",
      "/Volumes/Intel_oneAPI_Installer",
      "-quiet",
      "-nobrowse",
    ]);
    expect(mockedExec).toHaveBeenCalledWith("sudo", [
      expect.stringContaining("bootstrapper"),
      "-s",
      "--action",
      "install",
      "--eula",
      "accept",
      "--ignore-errors",
      "--components",
      "intel.oneapi.mac.ifort-compiler",
    ]);
    expect(mockedCache.saveCache).toHaveBeenCalled();
  });

  it("retries a transient bootstrapper failure", async () => {
    mockedCache.restoreCache.mockResolvedValue(undefined);
    mockedTc.downloadTool.mockResolvedValue("/tmp/ifort.dmg");
    const timeoutSpy = jest
      .spyOn(global, "setTimeout")
      .mockImplementation((callback) => {
        callback();
        return 0 as unknown as NodeJS.Timeout;
      });
    let installerAttempts = 0;
    mockedExec.mockImplementation(async (commandLine, args, options) => {
      if (
        commandLine === "sudo" &&
        typeof args?.[0] === "string" &&
        args[0].includes("bootstrapper")
      ) {
        installerAttempts++;
        if (installerAttempts === 1) {
          throw new Error("Cannot establish Internet connection");
        }
      }
      if (commandLine === "ifort" && args?.[0] === "--version") {
        options?.listeners?.stdout?.(
          Buffer.from("ifort (IFORT) 2021.10.0 20230609"),
        );
      }
      if (commandLine === "bash" && args?.[1]?.includes("setvars.sh")) {
        options?.listeners?.stdout?.(
          Buffer.from(
            "PATH=/opt/intel/oneapi/compiler/latest/bin\nONEAPI_ROOT=/opt/intel/oneapi",
          ),
        );
      }
      return 0;
    });

    try {
      await installDarwin(baseInputs);
    } finally {
      timeoutSpy.mockRestore();
    }

    expect(installerAttempts).toBe(2);
    expect(mockedCache.saveCache).toHaveBeenCalled();
  });

  it("throws error on ARM64", async () => {
    const inputs = { ...baseInputs, arch: Arch.ARM64 };
    await expect(installDarwin(inputs)).rejects.toThrow(
      "No supported versions found for ifort on darwin (arm64)",
    );
  });

  it("exports environment variables", async () => {
    mockedCache.restoreCache.mockResolvedValue("hit");

    await installDarwin(baseInputs);

    expect(mockedExportVariable).toHaveBeenCalledWith(
      "ONEAPI_ROOT",
      "/opt/intel/oneapi",
    );
  });

  it("resolves and returns the installed version", async () => {
    mockedCache.restoreCache.mockResolvedValue("hit");
    const result = await installDarwin(baseInputs);
    expect(result).toEqual({
      version: "ifort (IFORT) 2021.10.0 20230609",
      fc: "ifort",
      cc: "clang",
      cxx: "clang++",
    });
  });
});
