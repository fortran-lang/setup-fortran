import * as core from "@actions/core";
import * as exec from "@actions/exec";
import * as cache from "@actions/cache";
import * as fs from "fs";
import { installDebian } from "../../../src/installers/ifort/debian";
import { Arch, Compiler, OS, Msystem, type Inputs } from "../../../src/types";

jest.mock("@actions/core");
jest.mock("@actions/exec");
jest.mock("@actions/cache");
jest.mock("fs", () => ({
  ...jest.requireActual("fs"),
  existsSync: jest.fn(),
  mkdirSync: jest.fn(),
}));

describe("installDebian (ifort)", () => {
  const mockedExec = exec.exec as jest.MockedFunction<typeof exec.exec>;
  const mockedCache = cache as jest.Mocked<typeof cache>;
  const mockedFs = fs as jest.Mocked<typeof fs>;
  const mockedExportVariable = core.exportVariable as jest.MockedFunction<
    typeof core.exportVariable
  >;

  const baseInputs: Inputs = {
    compiler: Compiler.IFort,
    version: "2021.10",
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

  it("adds the Intel repository on cache miss", async () => {
    await installDebian(baseInputs);

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
      expect.objectContaining({ listeners: expect.any(Object) }),
    );
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

  it("installs the correct packages and saves to cache on miss", async () => {
    await installDebian(baseInputs);

    expect(mockedCache.restoreCache).toHaveBeenCalledWith(
      ["/opt/intel/oneapi"],
      "oneapi-ifort-validated-v1-x64-2023.2.4",
    );
    expect(mockedExec).toHaveBeenCalledWith("sudo", [
      "timeout",
      "--signal=TERM",
      "--kill-after=30s",
      "15m",
      "apt-get",
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
      "--no-install-recommends",
      "intel-oneapi-compiler-fortran-2023.2.4",
      "intel-oneapi-compiler-dpcpp-cpp-and-cpp-classic-2023.2.4",
    ]);
    expect(mockedCache.saveCache).toHaveBeenCalledWith(
      ["/opt/intel/oneapi"],
      "oneapi-ifort-validated-v1-x64-2023.2.4",
    );
  });

  it("retries apt-get install after a transient failure", async () => {
    // Avoid the real backoff sleep inside aptGetInstallWithRetry.
    const timeoutSpy = jest
      .spyOn(global, "setTimeout")
      .mockImplementation((callback) => {
        if (typeof callback === "function") callback();
        return 0 as unknown as NodeJS.Timeout;
      });

    let installAttempts = 0;
    // ifort's installer relies on exec.exec throwing on non-zero exit (no
    // ignoreReturnCode), so the mock must throw to simulate a transient failure.
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
      if (
        commandLine === "sudo" &&
        args?.includes("apt-get") &&
        args?.includes("install")
      ) {
        installAttempts++;
        if (installAttempts === 1) throw new Error("apt-get install failed");
      }
      return 0;
    });

    try {
      const result = await installDebian(baseInputs);
      expect(result.fc).toBe("ifort");
    } finally {
      timeoutSpy.mockRestore();
    }

    expect(installAttempts).toBe(2); // failed once, succeeded on retry
  });

  it("skips installation and restores from cache on hit", async () => {
    mockedCache.restoreCache.mockResolvedValue("hit");
    await installDebian(baseInputs);

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

  it("exports environment variables", async () => {
    await installDebian(baseInputs);

    expect(mockedExportVariable).toHaveBeenCalledWith(
      "ONEAPI_ROOT",
      "/opt/intel/oneapi",
    );
  });

  it("applies OpenMP workaround for 2024.1 bundle", async () => {
    // 2021.12 ifort corresponds to 2024.1 bundle
    const inputs = { ...baseInputs, version: "2021.12" };
    await installDebian(inputs);

    expect(mockedExportVariable).toHaveBeenCalledWith(
      "FFLAGS",
      expect.stringContaining("intel64"),
    );
  });

  it("resolves and returns the installed version", async () => {
    const result = await installDebian(baseInputs);
    expect(result).toEqual({
      version: "ifort (IFORT) 2021.10.0 20230609",
      fc: "ifort",
      cc: "icc",
      cxx: "icpc",
    });
  });

  it("advertises LLVM-based companion drivers for 2024+ bundles", async () => {
    // 2021.13 ifort corresponds to the 2024.2 bundle. Intel oneAPI 2024+
    // discontinued classic icc/icpc in favour of the LLVM icx/icpx drivers.
    const result = await installDebian({ ...baseInputs, version: "2021.13" });
    expect(result.fc).toBe("ifort");
    expect(result.cc).toBe("icx");
    expect(result.cxx).toBe("icpx");
  });

  it("installs the 2021.1.2 legacy spelling as oneAPI 2021.1.2 packages", async () => {
    const inputs = { ...baseInputs, version: "2021.1.2" };
    await installDebian(inputs);

    expect(mockedCache.restoreCache).toHaveBeenCalledWith(
      ["/opt/intel/oneapi"],
      "oneapi-ifort-validated-v1-x64-2021.1.2",
    );
    expect(mockedExec).toHaveBeenCalledWith("sudo", [
      "timeout",
      "--signal=TERM",
      "--kill-after=30s",
      "15m",
      "apt-get",
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
      "--no-install-recommends",
      "intel-oneapi-compiler-fortran-2021.1.2",
      "intel-oneapi-compiler-dpcpp-cpp-and-cpp-classic-2021.1.2",
    ]);
  });

  it("installs the 2021.7.1 legacy spelling as oneAPI 2022.2.1 packages", async () => {
    const inputs = { ...baseInputs, version: "2021.7.1" };
    await installDebian(inputs);

    expect(mockedCache.restoreCache).toHaveBeenCalledWith(
      ["/opt/intel/oneapi"],
      "oneapi-ifort-validated-v1-x64-2022.2.1",
    );
    expect(mockedExec).toHaveBeenCalledWith("sudo", [
      "timeout",
      "--signal=TERM",
      "--kill-after=30s",
      "15m",
      "apt-get",
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
      "--no-install-recommends",
      "intel-oneapi-compiler-fortran-2022.2.1",
      "intel-oneapi-compiler-dpcpp-cpp-and-cpp-classic-2022.2.1",
    ]);
  });
});
