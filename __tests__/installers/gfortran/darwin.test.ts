import * as core from "@actions/core";
import * as exec from "@actions/exec";
import { installDarwin } from "../../../src/installers/gfortran/darwin";
import { Arch, Compiler, OS, Msystem, type Inputs } from "../../../src/types";

jest.mock("@actions/core");
jest.mock("@actions/exec");

describe("installDarwin (gfortran)", () => {
  const mockedExec = exec.exec as jest.MockedFunction<typeof exec.exec>;
  const mockedExportVariable = core.exportVariable as jest.MockedFunction<
    typeof core.exportVariable
  >;

  const baseInputs: Inputs = {
    compiler: Compiler.GFortran,
    version: "14",
    os: OS.MacOS,
    osVersion: "13",
    arch: Arch.X64,
  cleanupDisk: false,
    updateEnvironment: true,
    msystem: Msystem.Native,
  };

  beforeEach(() => {
    jest.clearAllMocks();
    mockedExec.mockImplementation(async (commandLine, args, options) => {
      if (commandLine.includes("gfortran-14") && args?.[0] === "--version") {
        if (options?.listeners?.stdout) {
          options.listeners.stdout(
            Buffer.from("GNU Fortran (Homebrew GCC 14.1.0) 14.1.0"),
          );
        }
      }
      if (commandLine === "brew" && args?.[0] === "list") {
        return 1; // Not installed
      }
      if (commandLine === "brew" && args?.[0] === "--prefix") {
        if (options?.listeners?.stdout) {
          options.listeners.stdout(Buffer.from("/usr/local"));
        }
      }
      if (commandLine === "xcrun" && args?.[0] === "--show-sdk-path") {
        if (options?.listeners?.stdout) {
          options.listeners.stdout(Buffer.from("/path/to/SDK"));
        }
      }
      if (commandLine === "bash" && args?.[0] === "-c") {
        options?.listeners?.stdout?.(
          Buffer.from("/usr/local/Cellar/gcc@14/14.1.0/lib/gcc/14"),
        );
      }
      return 0;
    });
  });

  it("installs gcc via Homebrew if missing", async () => {
    await installDarwin(baseInputs);

    expect(mockedExec).toHaveBeenCalledWith(
      "brew",
      ["install", "--skip-post-install", "gcc@14"],
      expect.objectContaining({
        ignoreReturnCode: true,
        env: expect.objectContaining({ HOMEBREW_NO_AUTO_UPDATE: "1" }),
      }),
    );
    // Versioned Homebrew formulae don't create unversioned drivers; the
    // action must symlink gfortran/gcc/g++ -> <version> for downstream use.
    expect(mockedExec).toHaveBeenCalledWith("ln", [
      "-sf",
      "/usr/local/bin/gfortran-14",
      "/usr/local/bin/gfortran",
    ]);
    expect(mockedExec).toHaveBeenCalledWith("ln", [
      "-sf",
      "/usr/local/bin/gcc-14",
      "/usr/local/bin/gcc",
    ]);
    expect(mockedExec).toHaveBeenCalledWith("ln", [
      "-sf",
      "/usr/local/bin/g++-14",
      "/usr/local/bin/g++",
    ]);
    expect(mockedExec).not.toHaveBeenCalledWith(
      "bash",
      ["-c", expect.stringContaining("/usr/local/lib")],
    );
  });

  it("skips install if already present", async () => {
    mockedExec.mockImplementation(async (commandLine, args, options) => {
      if (commandLine === "brew" && args?.[0] === "list") {
        if (options?.listeners?.stdout) {
          options.listeners.stdout(Buffer.from("14.1.0"));
        }
        return 0;
      }
      if (commandLine === "brew" && args?.[0] === "--prefix") {
        if (options?.listeners?.stdout) {
          options.listeners.stdout(Buffer.from("/usr/local"));
        }
      }
      if (commandLine === "bash" && args?.[0] === "-c") {
        options?.listeners?.stdout?.(
          Buffer.from("/usr/local/Cellar/gcc@14/14.1.0/lib/gcc/14"),
        );
      }
      if (commandLine.includes("gfortran-14") && args?.[0] === "--version") {
        options?.listeners?.stdout?.(
          Buffer.from("GNU Fortran (Homebrew GCC 14.1.0) 14.1.0"),
        );
      }
      return 0;
    });

    await installDarwin(baseInputs);
    expect(mockedExec).not.toHaveBeenCalledWith("brew", ["install", "gcc@14"]);
  });

  it("exports environment variables and SDKROOT", async () => {
    await installDarwin(baseInputs);

    expect(mockedExportVariable).toHaveBeenCalledWith(
      "SDKROOT",
      "/path/to/SDK",
    );
    expect(mockedExportVariable).toHaveBeenCalledWith(
      "DYLD_FALLBACK_LIBRARY_PATH",
      expect.stringContaining("/lib/gcc/14"),
    );
    expect(mockedExportVariable).toHaveBeenCalledWith(
      "LIBRARY_PATH",
      "/path/to/SDK/usr/lib",
    );
  });

  it("resolves and returns the installed version", async () => {
    const result = await installDarwin(baseInputs);
    expect(result).toMatchObject({
      fc: expect.stringContaining("gfortran-14"),
      cc: expect.stringContaining("gcc-14"),
      cxx: expect.stringContaining("g++-14"),
    });
    expect(result.version).toContain("14.1.0");
  });
});
