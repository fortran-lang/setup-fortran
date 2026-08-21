import * as core from "@actions/core";
import * as exec from "@actions/exec";
import * as cache from "@actions/cache";
import * as tc from "@actions/tool-cache";
import * as os from "os";
import * as path from "path";
import * as fs from "fs";
import { installDebian } from "../../../src/installers/aocc/debian";
import {
  Arch,
  Compiler,
  OS,
  Msystem,
  type Inputs,
} from "../../../src/types";

jest.mock("@actions/core");
jest.mock("@actions/exec");
jest.mock("@actions/cache");
jest.mock("@actions/tool-cache");
jest.mock("os", () => ({
  ...jest.requireActual("os"),
  homedir: jest.fn().mockReturnValue("/home/user"),
  tmpdir: jest.fn().mockReturnValue("/tmp"),
  userInfo: jest.fn().mockReturnValue({ username: "user" }),
}));
jest.mock("fs", () => ({
  ...jest.requireActual("fs"),
  existsSync: jest.fn(),
}));

describe("installDebian (AOCC)", () => {
  const mockedExec = exec.exec as jest.MockedFunction<typeof exec.exec>;
  const mockedFs = fs as jest.Mocked<typeof fs>;
  const mockedCache = cache as jest.Mocked<typeof cache>;
  const mockedDownloadTool = tc.downloadTool as jest.MockedFunction<
    typeof tc.downloadTool
  >;
  const mockedExportVariable = core.exportVariable as jest.MockedFunction<
    typeof core.exportVariable
  >;

  const baseInputs: Inputs = {
    compiler: Compiler.AOCC,
    version: "5.1",
    os: OS.Linux,
    osVersion: "22.04",
    arch: Arch.X64,
  cleanupDisk: false,
    updateEnvironment: true,
    msystem: Msystem.Native,
  };

  const tempInstallDir = "/home/user/.aocc-cache";

  beforeEach(() => {
    jest.clearAllMocks();
    mockedFs.existsSync.mockReturnValue(false); // Assume not installed
    mockedCache.restoreCache.mockResolvedValue(undefined); // Cache miss
    mockedDownloadTool.mockResolvedValue("/tmp/aocc-compiler-5.1.0_1_amd64.deb");
    mockedExec.mockImplementation(async (commandLine, args, options) => {
      if (commandLine === "bash" && args?.[1] === 'source "/opt/AMD/aocc-compiler-5.1.0/setenv_AOCC.sh" && env') {
        if (options?.listeners?.stdout) {
          options.listeners.stdout(Buffer.from("PATH=/opt/AMD/aocc/bin:/usr/bin\nLD_LIBRARY_PATH=/opt/AMD/aocc/lib\nAOCC_DIR=/opt/AMD/aocc\n"));
        }
      }
      if (commandLine === "/opt/AMD/aocc-compiler-5.1.0/bin/flang" && args?.[0] === "--version") {
        if (options?.listeners?.stdout) {
          options.listeners.stdout(Buffer.from("AOCC flang version 5.1.0"));
        }
      }
      return 0;
    });
  });

  it("downloads and installs on cache miss", async () => {
    await installDebian(baseInputs);

    expect(mockedCache.restoreCache).toHaveBeenCalledWith(
      [tempInstallDir],
      expect.stringContaining("aocc-5.1-x64-22.04"),
    );
    expect(mockedDownloadTool).toHaveBeenCalledWith(
      expect.stringContaining("aocc-5"),
      expect.stringContaining("aocc-compiler-5.1.0_1_amd64.deb"),
      undefined,
      { "User-Agent": "Mozilla/5.0" },
    );
    expect(mockedExec).toHaveBeenCalledWith("sudo", ["dpkg", "-i", expect.stringContaining("aocc-compiler-5.1.0_1_amd64.deb")]);
    
    expect(mockedExec).toHaveBeenCalledWith("sudo", ["cp", "-rT", "/opt/AMD/aocc-compiler-5.1.0", tempInstallDir]);
    expect(mockedCache.saveCache).toHaveBeenCalledWith(
      [tempInstallDir],
      expect.stringContaining("aocc-5.1-x64-22.04"),
    );
  });

  it("skips download and restores from cache on cache hit", async () => {
    mockedCache.restoreCache.mockResolvedValue("hit");
    await installDebian(baseInputs);

    expect(mockedExec).toHaveBeenCalledWith("sudo", ["mv", tempInstallDir, "/opt/AMD/aocc-compiler-5.1.0"]);
    expect(mockedExec).not.toHaveBeenCalledWith("curl", expect.anything());
    expect(mockedCache.saveCache).not.toHaveBeenCalled();
  });

  it("skips download when already installed on disk but cache miss", async () => {
    mockedFs.existsSync.mockReturnValue(true);
    await installDebian(baseInputs);

    expect(mockedExec).not.toHaveBeenCalledWith("curl", expect.anything());
    expect(mockedExec).not.toHaveBeenCalledWith("sudo", ["dpkg", "-i", expect.anything()]);
    expect(mockedCache.saveCache).not.toHaveBeenCalled();
  });

  it("sources setenv script and exports variables", async () => {
    await installDebian(baseInputs);

    expect(mockedExportVariable).toHaveBeenCalledWith("PATH", "/opt/AMD/aocc/bin:/usr/bin");
    expect(mockedExportVariable).toHaveBeenCalledWith("LD_LIBRARY_PATH", "/opt/AMD/aocc/lib");
  });

  it("resolves and returns the installed version", async () => {
    const result = await installDebian(baseInputs);
    expect(result).toEqual({
      version: "AOCC flang version 5.1.0",
      fc: "flang",
      cc: "clang",
      cxx: "clang++",
    });
  });

  it("normalizes 5.1.0 input to 5.1 release entry", async () => {
    const inputs: Inputs = { ...baseInputs, version: "5.1.0" };
    const result = await installDebian(inputs);
    expect(result).toEqual({
      version: "AOCC flang version 5.1.0",
      fc: "flang",
      cc: "clang",
      cxx: "clang++",
    });
    expect(mockedDownloadTool).toHaveBeenCalledWith(
      expect.stringContaining("aocc-compiler-5.1.0_1_amd64.deb"),
      expect.stringContaining("aocc-compiler-5.1.0_1_amd64.deb"),
      undefined,
      { "User-Agent": "Mozilla/5.0" },
    );
  });

  it("rejects non-zero patch versions like 5.1.1", async () => {
    const inputs: Inputs = { ...baseInputs, version: "5.1.1" };
    await expect(installDebian(inputs)).rejects.toThrow(
      "aocc 5.1.1 is not supported on linux (x64). Supported versions: 5.2, 5.1, 5.0, 4.2, 4.1",
    );
  });
});
