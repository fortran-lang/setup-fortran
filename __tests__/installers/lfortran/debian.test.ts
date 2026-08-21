import * as core from "@actions/core";
import * as exec from "@actions/exec";
import * as fs from "fs";
import { installDebian } from "../../../src/installers/lfortran/debian";
import { Arch, Compiler, OS, Msystem, type Inputs } from "../../../src/types";

jest.mock("@actions/core");
jest.mock("@actions/exec");
jest.mock("../../../src/verify_download");
jest.mock("fs", () => ({
  ...jest.requireActual("fs"),
  existsSync: jest.fn(),
  rmSync: jest.fn(),
}));

describe("installDebian (LFortran)", () => {
  const mockedExec = exec.exec as jest.MockedFunction<typeof exec.exec>;
  const mockedFs = fs as jest.Mocked<typeof fs>;
  const mockedExportVariable = core.exportVariable as jest.MockedFunction<
    typeof core.exportVariable
  >;
  let environmentCreated: boolean;

  const baseInputs: Inputs = {
    compiler: Compiler.LFortran,
    version: "0.63.0",
    os: OS.Linux,
    osVersion: "22.04",
    arch: Arch.X64,
    cleanupDisk: false,
    updateEnvironment: true,
    msystem: Msystem.Native,
  };

  beforeEach(() => {
    jest.clearAllMocks();
    environmentCreated = false;
    mockedFs.existsSync.mockImplementation(() => environmentCreated);
    mockedExec.mockImplementation(async (commandLine, args, options) => {
      if (args?.[0] === "create") environmentCreated = true;
      if (args?.[0] === "run" && args.includes("lfortran")) {
        options?.listeners?.stdout?.(Buffer.from("LFortran version 0.63.0"));
      }
      if (commandLine.includes("lfortran") && args?.[0] === "--version") {
        if (options?.listeners?.stdout) {
          options.listeners.stdout(Buffer.from("LFortran version 0.63.0"));
        }
      }
      return 0;
    });
  });

  it("downloads and installs Miniforge", async () => {
    await installDebian(baseInputs);

    expect(mockedExec).toHaveBeenCalledWith("curl", [
      "-fsSL",
      "--retry",
      "3",
      "--retry-delay",
      "15",
      "-o",
      expect.stringContaining("miniforge.sh"),
      expect.stringContaining("Miniforge3-26.3.2-2-Linux-x86_64.sh"),
    ]);
    expect(mockedExec).toHaveBeenCalledWith("bash", [
      expect.stringContaining("miniforge.sh"),
      "-b",
      "-p",
      expect.stringContaining("miniforge"),
    ]);
  });

  it("installs lfortran via conda", async () => {
    await installDebian(baseInputs);

    expect(mockedExec).toHaveBeenCalledWith(
      expect.stringContaining("conda"),
      expect.arrayContaining([
        "create",
        "-y",
        "-p",
        expect.stringContaining("0.63.0"),
        "lfortran==0.63.0",
      ]),
    );
  });

  it("reuses a valid environment on a second invocation", async () => {
    await installDebian(baseInputs);
    await installDebian(baseInputs);

    expect(
      mockedExec.mock.calls.filter(([command]) => command === "curl"),
    ).toHaveLength(1);
    expect(core.info).toHaveBeenCalledWith(
      expect.stringContaining("Reusing LFortran 0.63.0"),
    );
  });

  it("removes and rebuilds a partial versioned environment", async () => {
    mockedFs.existsSync.mockImplementation((filePath) => {
      if (environmentCreated) return true;
      const value = String(filePath);
      if (value.endsWith("/miniforge/bin/conda")) return true;
      if (value.endsWith("/env/bin/lfortran")) return false;
      return value.includes("/setup-fortran/lfortran/linux/x64/0.63.0");
    });

    await installDebian(baseInputs);

    expect(mockedFs.rmSync).toHaveBeenCalledWith(
      expect.stringContaining("setup-fortran/lfortran/linux/x64/0.63.0"),
      { recursive: true, force: true },
    );
    expect(mockedExec).toHaveBeenCalledWith("curl", expect.any(Array));
  });

  it("throws error on ARM64", async () => {
    const inputs = { ...baseInputs, arch: Arch.ARM64 };
    await expect(installDebian(inputs)).rejects.toThrow(
      "LFortran is not available for Linux ARM64 on conda-forge",
    );
  });

  it("exports environment variables", async () => {
    await installDebian(baseInputs);

    expect(core.addPath).toHaveBeenCalledWith(expect.stringContaining("bin"));
    expect(mockedExportVariable).toHaveBeenCalledWith(
      "LFORTRAN_OMP_LIB_DIR",
      expect.stringContaining("lib"),
    );
  });

  it("resolves and returns the installed version", async () => {
    const result = await installDebian(baseInputs);
    expect(result).toEqual({
      version: "LFortran version 0.63.0",
      fc: "lfortran",
      cc: "clang",
      cxx: "clang++",
    });
  });
});
