import * as core from "@actions/core";
import * as exec from "@actions/exec";
import * as fs from "fs";
import { installDebian } from "../../../src/installers/flang/debian";
import { Arch, Compiler, OS, Msystem, type Inputs } from "../../../src/types";

jest.mock("@actions/core", () => ({
  info: jest.fn(),
  addPath: jest.fn(),
  exportVariable: jest.fn((name, value) => {
    process.env[name] = value;
  }),
  warning: jest.fn(),
}));
jest.mock("@actions/exec");
jest.mock("../../../src/verify_download");
jest.mock("fs", () => ({
  ...jest.requireActual("fs"),
  existsSync: jest.fn(),
}));

describe("installDebian (Flang)", () => {
  const mockedExec = exec.exec as jest.MockedFunction<typeof exec.exec>;
  const mockedFs = fs as jest.Mocked<typeof fs>;
  const mockedExportVariable = core.exportVariable as jest.MockedFunction<
    typeof core.exportVariable
  >;

  const baseInputs: Inputs = {
    compiler: Compiler.Flang,
    version: "18",
    os: OS.Linux,
    osVersion: "22.04",
    arch: Arch.X64,
    cleanupDisk: false,
    updateEnvironment: true,
    msystem: Msystem.Native,
  };

  const originalEnv = process.env;

  beforeEach(() => {
    jest.clearAllMocks();
    process.env = { ...originalEnv };
    mockedFs.existsSync.mockReturnValue(true);
    mockedExec.mockImplementation(async (commandLine, args, options) => {
      if (
        (commandLine.startsWith("flang-new") ||
          commandLine.startsWith("flang")) &&
        args?.[0] === "--version"
      ) {
        if (options?.listeners?.stdout) {
          options.listeners.stdout(Buffer.from("flang version 18.1.0"));
        }
      }
      return 0;
    });
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it("configures the explicit LLVM repository without executing llvm.sh", async () => {
    await installDebian(baseInputs);

    expect(mockedExec).toHaveBeenCalledWith(
      "curl",
      expect.arrayContaining([
        "-o",
        expect.stringContaining("llvm-snapshot.gpg.key"),
        "https://apt.llvm.org/llvm-snapshot.gpg.key",
      ]),
    );
    expect(mockedExec).not.toHaveBeenCalledWith(
      "bash",
      expect.arrayContaining([expect.stringContaining("llvm.sh")]),
    );
  });

  it("installs the correct flang package", async () => {
    await installDebian(baseInputs);

    expect(mockedExec).toHaveBeenCalledWith("sudo", [
      "timeout",
      "--signal=TERM",
      "--kill-after=30s",
      "15m",
      "apt-get",
      "install",
      "-y",
      "-o",
      "Acquire::ForceIPv4=true",
      "-o",
      "Acquire::Retries=0",
      "-o",
      "Acquire::http::Timeout=10",
      "-o",
      "Acquire::https::Timeout=10",
      "clang-18",
      "flang-18",
      "libomp-18-dev",
      "libclang-rt-18-dev",
    ]);
  });

  it("retries apt-get update after a transient failure", async () => {
    // Avoid the real backoff sleep inside aptGetUpdateWithRetry.
    const timeoutSpy = jest
      .spyOn(global, "setTimeout")
      .mockImplementation((callback) => {
        if (typeof callback === "function") callback();
        return 0 as unknown as NodeJS.Timeout;
      });

    let updateAttempts = 0;
    // flang's update retry is exit-code driven (ignoreReturnCode: true +
    // exitCode === 0 check), so the mock returns a non-zero code to fail,
    // rather than throwing (which is the gfortran/aptGetUpdateWithRetry style).
    mockedExec.mockImplementation(async (commandLine, args, options) => {
      if (
        (commandLine.startsWith("flang-new") ||
          commandLine.startsWith("flang")) &&
        args?.[0] === "--version"
      ) {
        if (options?.listeners?.stdout) {
          options.listeners.stdout(Buffer.from("flang version 18.1.0"));
        }
      }
      if (
        commandLine === "sudo" &&
        args?.includes("apt-get") &&
        args?.includes("update")
      ) {
        updateAttempts++;
        if (updateAttempts === 1) return 1; // fail the first update attempt
      }
      return 0;
    });

    try {
      const result = await installDebian(baseInputs);
      expect(result.fc).toBe("flang-new-18");
    } finally {
      timeoutSpy.mockRestore();
    }

    expect(updateAttempts).toBe(2); // failed once, succeeded on retry
    expect(core.warning).toHaveBeenCalledWith(
      expect.stringContaining("apt-get update failed (attempt 1/3)"),
    );
    expect(mockedExec).toHaveBeenCalledWith(
      "sudo",
      [
        "timeout",
        "--signal=TERM",
        "--kill-after=10s",
        "5m",
        "apt-get",
        "update",
        "-y",
        "-o",
        "Acquire::ForceIPv4=true",
        "-o",
        "Acquire::Retries=0",
        "-o",
        "Acquire::http::Timeout=10",
        "-o",
        "Acquire::https::Timeout=10",
      ],
      { ignoreReturnCode: true },
    );
  });

  it("does not write global APT settings or rewrite Ubuntu mirrors", async () => {
    await installDebian(baseInputs);

    expect(mockedExec).not.toHaveBeenCalledWith(
      "sudo",
      expect.arrayContaining([
        expect.stringMatching(/apt\.conf\.d|ubuntu\.sources|apt-mirrors/),
      ]),
    );
  });

  it("configures update-alternatives for flang-new (15 <= major < 20)", async () => {
    const inputs = { ...baseInputs, version: "17" };
    await installDebian(inputs);

    expect(mockedExec).toHaveBeenCalledWith("sudo", [
      "update-alternatives",
      "--install",
      "/usr/bin/flang",
      "flang",
      "/usr/lib/llvm-17/bin/flang-new",
      "100",
    ]);
  });

  it("configures update-alternatives for flang (major >= 20)", async () => {
    const inputs = { ...baseInputs, version: "20" };
    await installDebian(inputs);

    expect(mockedExec).toHaveBeenCalledWith("sudo", [
      "update-alternatives",
      "--install",
      "/usr/bin/flang",
      "flang",
      "/usr/lib/llvm-20/bin/flang",
      "100",
    ]);
  });

  it("exports environment variables and adds to PATH", async () => {
    await installDebian(baseInputs);

    expect(core.addPath).toHaveBeenCalledWith("/usr/lib/llvm-18/bin");
    expect(mockedExportVariable).toHaveBeenCalledWith(
      "LIBRARY_PATH",
      "/usr/lib/llvm-18/lib",
    );
  });

  it("exports flang-20 for FC when version is 20", async () => {
    const inputs = { ...baseInputs, version: "20" };
    await installDebian(inputs);
  });

  it("resolves and returns the installed version", async () => {
    const result = await installDebian(baseInputs);
    expect(result).toEqual({
      version: "flang version 18.1.0",
      fc: "flang-new-18",
      cc: "/usr/lib/llvm-18/bin/clang",
      cxx: "/usr/lib/llvm-18/bin/clang++",
    });
  });

  it("falls back to versioned symlink if primary binary is missing", async () => {
    mockedFs.existsSync.mockImplementation((path) => {
      if (path === "/usr/lib/llvm-18/bin/flang-new") return false;
      if (path === "/usr/bin/flang-new-18") return true;
      return true;
    });

    await installDebian(baseInputs);

    expect(mockedExec).toHaveBeenCalledWith("sudo", [
      "update-alternatives",
      "--install",
      "/usr/bin/flang",
      "flang",
      "/usr/bin/flang-new-18",
      "100",
    ]);
  });

  it("skips update-alternatives if binary is already /usr/bin/flang", async () => {
    mockedFs.existsSync.mockImplementation((path) => {
      if (path === "/usr/lib/llvm-18/bin/flang-new") return false;
      if (path === "/usr/bin/flang-new-18") return false;
      if (path === "/usr/bin/flang-new-18") return false;
      if (path === "/usr/bin/flang") return true;
      return true;
    });

    await installDebian(baseInputs);

    expect(mockedExec).not.toHaveBeenCalledWith("sudo", [
      "update-alternatives",
      "--install",
      "/usr/bin/flang",
      "flang",
      "/usr/bin/flang",
      "100",
    ]);
  });

  it("throws error if no flang binary is found", async () => {
    mockedFs.existsSync.mockReturnValue(false);

    await expect(installDebian(baseInputs)).rejects.toThrow(
      /Flang binary not found/,
    );
  });
});
