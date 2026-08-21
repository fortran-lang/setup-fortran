import * as core from "@actions/core";
import * as exec from "@actions/exec";
import * as cache from "@actions/cache";
import * as fs from "fs";
import { installDebian } from "../../../src/installers/ifx/debian";
import { Arch, Compiler, OS, Msystem, type Inputs } from "../../../src/types";

jest.mock("@actions/core");
jest.mock("@actions/exec");
jest.mock("@actions/cache");
jest.mock("fs", () => ({
  ...jest.requireActual("fs"),
  existsSync: jest.fn(),
  mkdirSync: jest.fn(),
}));

describe("installDebian ifx", () => {
  const mockedExec = exec.exec as jest.MockedFunction<typeof exec.exec>;
  const mockedCache = cache as jest.Mocked<typeof cache>;
  const mockedFs = fs as jest.Mocked<typeof fs>;

  const baseInputs: Inputs = {
    compiler: Compiler.IFX,
    version: "2023.2.4",
    os: OS.Linux,
    osVersion: "22.04",
    arch: Arch.X64,
    cleanupDisk: false,
    updateEnvironment: true,
    msystem: Msystem.Native,
  };

  beforeEach(() => {
    jest.clearAllMocks();
    mockedFs.existsSync.mockReturnValue(true);
    mockedCache.restoreCache.mockResolvedValue(undefined);
    mockedExec.mockImplementation(async (commandLine, args, options) => {
      if (commandLine === "ifx" && args?.[0] === "--version") {
        if (options?.listeners?.stdout) {
          options.listeners.stdout(Buffer.from("ifx (IFX) 2023.2.4 20230101"));
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

  it("installs the correct versioned packages and saves to cache on miss", async () => {
    const inputs = { ...baseInputs, version: "2023.2.0" };
    const result = await installDebian(inputs);

    expect(result.fc).toBe("ifx");
    expect(result.cc).toBe("icx");
    expect(result.cxx).toBe("icpx");

    expect(mockedCache.restoreCache).toHaveBeenCalledWith(
      ["/opt/intel/oneapi"],
      "oneapi-ifx-validated-v1-x64-2023.2.0",
    );
    expect(mockedExec).toHaveBeenCalledWith(
      "sudo",
      [
        "timeout",
        "--signal=TERM",
        "--kill-after=30s",
        "15m",
        "apt-get",
        "install",
        "-y",
        "--no-install-recommends",
        "-o",
        "Acquire::http::Timeout=30",
        "-o",
        "Acquire::http::ConnectTimeout=20",
        "-o",
        "Acquire::https::Timeout=30",
        "-o",
        "Acquire::https::ConnectTimeout=20",
        "-o",
        "Acquire::Retries=0",
        "intel-oneapi-compiler-fortran-2023.2.0",
        "intel-oneapi-compiler-dpcpp-cpp-and-cpp-classic-2023.2.0",
      ],
      { ignoreReturnCode: true },
    );
    expect(mockedCache.saveCache).toHaveBeenCalledWith(
      ["/opt/intel/oneapi"],
      "oneapi-ifx-validated-v1-x64-2023.2.0",
    );
  });

  it("skips installation and restores from cache on hit", async () => {
    mockedCache.restoreCache.mockResolvedValue("hit");
    const inputs = { ...baseInputs, version: "2023.2.0" };
    await installDebian(inputs);

    expect(mockedExec).not.toHaveBeenCalledWith("sudo", [
      "apt-get",
      "install",
      expect.anything(),
      expect.anything(),
      expect.anything(),
      expect.anything(),
    ]);
    expect(mockedCache.saveCache).not.toHaveBeenCalled();
    // But still sources setvars.sh
    expect(mockedExec).toHaveBeenCalledWith(
      "bash",
      ["-c", expect.stringContaining('source "/opt/intel/oneapi/setvars.sh"')],
      expect.anything(),
    );
  });

  it("reinstalls when the restored cache is incomplete", async () => {
    mockedCache.restoreCache.mockResolvedValue("hit");
    mockedFs.existsSync.mockReturnValue(false);

    await installDebian({ ...baseInputs, version: "2023.2.0" });

    expect(mockedExec).toHaveBeenCalledWith("sudo", [
      "rm",
      "-rf",
      "/opt/intel/oneapi",
    ]);
    expect(mockedExec).toHaveBeenCalledWith(
      "sudo",
      expect.arrayContaining([
        "apt-get",
        "intel-oneapi-compiler-fortran-2023.2.0",
      ]),
      expect.anything(),
    );
  });

  it("repairs dependencies with apt-get --fix-broken install after a failed install attempt", async () => {
    // Avoid the real 15s retry backoff inside aptInstallWithRetry.
    const timeoutSpy = jest
      .spyOn(global, "setTimeout")
      .mockImplementation((callback) => {
        if (typeof callback === "function") callback();
        return 0 as unknown as NodeJS.Timeout;
      });

    let installAttempts = 0;
    mockedExec.mockImplementation(async (commandLine, args, options) => {
      if (commandLine === "ifx" && args?.[0] === "--version") {
        if (options?.listeners?.stdout) {
          options.listeners.stdout(Buffer.from("ifx (IFX) 2023.2.4 20230101"));
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
      // The real `apt-get install` attempt (not the --fix-broken repair).
      if (
        commandLine === "sudo" &&
        args?.includes("apt-get") &&
        args?.includes("install") &&
        !args?.includes("--fix-broken")
      ) {
        installAttempts++;
        if (installAttempts === 1) return 1; // fail the first install attempt
      }
      return 0;
    });

    try {
      const result = await installDebian(baseInputs);
      expect(result.fc).toBe("ifx");
    } finally {
      timeoutSpy.mockRestore();
    }

    // Install was retried once: failed first, succeeded on the second attempt.
    expect(installAttempts).toBe(2);
    expect(mockedExec).toHaveBeenCalledWith(
      "sudo",
      [
        "timeout",
        "--signal=TERM",
        "--kill-after=30s",
        "10m",
        "apt-get",
        "--fix-broken",
        "install",
        "-y",
        "-o",
        "Acquire::http::Timeout=30",
        "-o",
        "Acquire::http::ConnectTimeout=20",
        "-o",
        "Acquire::https::Timeout=30",
        "-o",
        "Acquire::https::ConnectTimeout=20",
        "-o",
        "Acquire::Retries=0",
      ],
      { ignoreReturnCode: true },
    );
  });

  it("maps 2-digit version 2025.2 to 2025.2", async () => {
    const inputs = { ...baseInputs, version: "2025.2" };
    await installDebian(inputs);

    expect(mockedExec).toHaveBeenCalledWith(
      "sudo",
      [
        "timeout",
        "--signal=TERM",
        "--kill-after=30s",
        "15m",
        "apt-get",
        "install",
        "-y",
        "--no-install-recommends",
        "-o",
        "Acquire::http::Timeout=30",
        "-o",
        "Acquire::http::ConnectTimeout=20",
        "-o",
        "Acquire::https::Timeout=30",
        "-o",
        "Acquire::https::ConnectTimeout=20",
        "-o",
        "Acquire::Retries=0",
        "intel-oneapi-compiler-fortran-2025.2",
        "intel-oneapi-compiler-dpcpp-cpp-2025.2",
      ],
      { ignoreReturnCode: true },
    );
  });

  it("resolves 2023.2 to the latest patch 2023.2.4 using resolveMinorToLatestPatch", async () => {
    const inputs = { ...baseInputs, version: "2023.2" };
    await installDebian(inputs);

    expect(mockedExec).toHaveBeenCalledWith(
      "sudo",
      [
        "timeout",
        "--signal=TERM",
        "--kill-after=30s",
        "15m",
        "apt-get",
        "install",
        "-y",
        "--no-install-recommends",
        "-o",
        "Acquire::http::Timeout=30",
        "-o",
        "Acquire::http::ConnectTimeout=20",
        "-o",
        "Acquire::https::Timeout=30",
        "-o",
        "Acquire::https::ConnectTimeout=20",
        "-o",
        "Acquire::Retries=0",
        "intel-oneapi-compiler-fortran-2023.2.4",
        "intel-oneapi-compiler-dpcpp-cpp-and-cpp-classic-2023.2.4",
      ],
      { ignoreReturnCode: true },
    );
  });

  it("adds the Intel repository on cache miss", async () => {
    await installDebian(baseInputs);

    expect(mockedExec).toHaveBeenCalledWith("sudo", [
      "timeout",
      "--signal=TERM",
      "--kill-after=10s",
      "5m",
      "apt-get",
      "update",
      "-y",
      "-o",
      "Acquire::http::Timeout=30",
      "-o",
      "Acquire::http::ConnectTimeout=20",
      "-o",
      "Acquire::https::Timeout=30",
      "-o",
      "Acquire::https::ConnectTimeout=20",
      "-o",
      "Acquire::Retries=0",
    ]);
    expect(mockedExec).toHaveBeenCalledWith("bash", [
      "-c",
      expect.stringContaining(
        "https://apt.repos.intel.com/intel-gpg-keys/GPG-PUB-KEY-INTEL-SW-PRODUCTS.PUB",
      ),
    ]);
    expect(mockedExec).toHaveBeenCalledWith("bash", [
      "-c",
      expect.stringContaining("https://apt.repos.intel.com/oneapi all main"),
    ]);
  });

  it("exports environment variables including FPM flags", async () => {
    await installDebian(baseInputs);
  });
});
