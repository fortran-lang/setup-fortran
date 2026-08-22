import * as core from "@actions/core";
import * as exec from "@actions/exec";
import * as fs from "fs";
import { installDarwin } from "../../../src/installers/lfortran/darwin";
import { Arch, Compiler, OS, Msystem, type Inputs } from "../../../src/types";

jest.mock("@actions/core");
jest.mock("@actions/exec");
jest.mock("../../../src/verify_download");
jest.mock("fs", () => ({
  ...jest.requireActual("fs"),
  existsSync: jest.fn(),
}));

describe("installDarwin (LFortran)", () => {
  const mockedExec = exec.exec as jest.MockedFunction<typeof exec.exec>;
  const mockedFs = fs as jest.Mocked<typeof fs>;
  const mockedExportVariable = core.exportVariable as jest.MockedFunction<
    typeof core.exportVariable
  >;
  let environmentCreated: boolean;

  const baseInputs: Inputs = {
    compiler: Compiler.LFortran,
    version: "0.63.0",
    os: OS.MacOS,
    osVersion: "13",
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
      if (
        commandLine.includes("conda") &&
        args?.[0] === "run" &&
        args?.[3] === "lfortran" &&
        args?.[4] === "--version"
      ) {
        if (options?.listeners?.stdout) {
          options.listeners.stdout(Buffer.from("LFortran version 0.63.0"));
        }
      }
      if (commandLine === "xcrun" && args?.[0] === "--show-sdk-path") {
        if (options?.listeners?.stdout) {
          options.listeners.stdout(Buffer.from("/path/to/SDK"));
        }
      }
      return 0;
    });
  });

  it("downloads and installs Miniforge", async () => {
    await installDarwin(baseInputs);

    expect(mockedExec).toHaveBeenCalledWith("curl", [
      "-fsSL",
      "--retry",
      "3",
      "--retry-delay",
      "15",
      "-o",
      expect.stringContaining("miniforge.sh"),
      expect.stringContaining("Miniforge3-26.3.2-2-MacOSX-x86_64.sh"),
    ]);
    expect(mockedExec).toHaveBeenCalledWith("bash", [
      expect.stringContaining("miniforge.sh"),
      "-b",
      "-p",
      expect.stringContaining("miniforge"),
    ]);
  });

  it("installs lfortran via conda", async () => {
    await installDarwin(baseInputs);

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
    await installDarwin(baseInputs);
    await installDarwin(baseInputs);

    expect(
      mockedExec.mock.calls.filter(([command]) => command === "curl"),
    ).toHaveLength(1);
  });

  it("exports environment variables and SDKROOT", async () => {
    await installDarwin(baseInputs);

    expect(core.addPath).toHaveBeenCalledWith(expect.stringContaining("bin"));
    expect(mockedExportVariable).toHaveBeenCalledWith(
      "SDKROOT",
      "/path/to/SDK",
    );
  });

  it("resolves and returns the installed version", async () => {
    const result = await installDarwin(baseInputs);
    expect(result).toEqual({
      version: "LFortran version 0.63.0",
      fc: expect.stringContaining("lfortran"),
      cc: "clang",
      cxx: "clang++",
    });
  });
});
