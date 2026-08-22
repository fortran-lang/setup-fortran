import * as core from "@actions/core";
import * as exec from "@actions/exec";
import * as cache from "@actions/cache";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import {
  installDebian,
  needsPpa,
} from "../../../src/installers/gfortran/debian";
import { Arch, Compiler, OS, Msystem, type Inputs } from "../../../src/types";

jest.mock("@actions/core");
jest.mock("@actions/exec");
jest.mock("@actions/cache");

describe("GFortran Debian Installer", () => {
  const mockedExec = exec.exec as jest.MockedFunction<typeof exec.exec>;
  const mockedCache = cache as jest.Mocked<typeof cache>;

  const baseInputs: Inputs = {
    compiler: Compiler.GFortran,
    version: "14",
    os: OS.Linux,
    osVersion: "20.04.6",
    arch: Arch.X64,
    cleanupDisk: false,
    updateEnvironment: true,
    msystem: Msystem.Native,
  };

  const testRunnerTemp = path.join(os.tmpdir(), "setup-fortran-gfortran-tests");
  const cacheDir = path.join(
    testRunnerTemp,
    "setup-fortran",
    "apt",
    "gfortran",
    "20.04.6",
    "x64",
    "14",
  );
  const cacheKey = "apt-gfortran-v2-20.04.6-x64-14";

  beforeEach(() => {
    jest.clearAllMocks();
    jest.useRealTimers();
    process.env.RUNNER_TEMP = testRunnerTemp;
    mockedCache.restoreCache.mockResolvedValue(undefined);
    mockedExec.mockImplementation(async (commandLine, args, options) => {
      if (commandLine === "gfortran" && args?.[0] === "--version") {
        if (options?.listeners?.stdout) {
          options.listeners.stdout(
            Buffer.from("GNU Fortran (Ubuntu 14.2.0-1ubuntu2~22.04) 14.2.0"),
          );
        }
      }
      return 0;
    });
  });

  afterAll(() => {
    fs.rmSync(testRunnerTemp, { recursive: true, force: true });
  });

  describe("needsPpa", () => {
    it("returns true for version >= 15 on Ubuntu 24.04", () => {
      expect(needsPpa("15", "24.04")).toBe(true);
      expect(needsPpa("16", "24.04")).toBe(true);
    });

    it("returns false for version < 15 on Ubuntu 24.04", () => {
      expect(needsPpa("14", "24.04")).toBe(false);
      expect(needsPpa("13", "24.04")).toBe(false);
    });

    it("returns true for version >= 13 on Ubuntu 22.04", () => {
      expect(needsPpa("13", "22.04")).toBe(true);
      expect(needsPpa("14", "22.04")).toBe(true);
    });

    it("returns false for version < 13 on Ubuntu 22.04", () => {
      expect(needsPpa("12", "22.04")).toBe(false);
      expect(needsPpa("11", "22.04")).toBe(false);
    });

    it("returns true for other OS versions regardless of compiler version", () => {
      expect(needsPpa("11", "20.04")).toBe(true);
      expect(needsPpa("16", "20.04")).toBe(true);
      expect(needsPpa("14", "debian-12")).toBe(true);
    });
  });

  describe("installDebian", () => {
    it("adds PPA when needsPpa returns true", async () => {
      const inputs = { ...baseInputs, version: "15", osVersion: "24.04" };
      await installDebian(inputs);

      expect(mockedExec).toHaveBeenCalledWith("sudo", [
        "add-apt-repository",
        "--yes",
        "ppa:ubuntu-toolchain-r/test",
      ]);
    });

    it("does not add PPA when needsPpa returns false", async () => {
      const inputs = { ...baseInputs, version: "14", osVersion: "24.04" };
      await installDebian(inputs);

      expect(mockedExec).not.toHaveBeenCalledWith("sudo", [
        "add-apt-repository",
        "--yes",
        "ppa:ubuntu-toolchain-r/test",
      ]);
    });

    it("always updates apt and installs gfortran on cache miss", async () => {
      const result = await installDebian(baseInputs);

      expect(result.fc).toBe("gfortran-14");
      expect(result.cc).toBe("gcc-14");
      expect(result.cxx).toBe("g++-14");
      expect(mockedCache.restoreCache).toHaveBeenCalledWith(
        [cacheDir],
        cacheKey,
      );
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
        "-o",
        `Dir::Cache::archives=${cacheDir}`,
        "gcc-14",
        "g++-14",
        "gfortran-14",
      ]);
      expect(mockedExec).toHaveBeenCalledWith("sudo", [
        "chown",
        "-R",
        os.userInfo().username,
        cacheDir,
      ]);
      expect(mockedCache.saveCache).toHaveBeenCalledWith([cacheDir], cacheKey);
      expect(fs.existsSync(path.join(cacheDir, "partial"))).toBe(false);
    });

    it("separates x64 and ARM64 caches", async () => {
      await installDebian({ ...baseInputs, arch: Arch.ARM64 });

      expect(mockedCache.restoreCache).toHaveBeenCalledWith(
        [expect.stringContaining(path.join("arm64", "14"))],
        "apt-gfortran-v2-20.04.6-arm64-14",
      );
    });

    it("installs from cache on cache hit", async () => {
      mockedCache.restoreCache.mockResolvedValue("hit");
      await installDebian(baseInputs);

      expect(mockedExec).toHaveBeenCalledWith("sudo", [
        "apt-get",
        "install",
        "-y",
        "--no-download",
        "-o",
        `Dir::Cache::archives=${cacheDir}`,
        "gcc-14",
        "g++-14",
        "gfortran-14",
      ]);
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
      expect(mockedCache.saveCache).not.toHaveBeenCalled();
    });

    it("falls back to an online install when cached packages are incomplete", async () => {
      mockedCache.restoreCache.mockResolvedValue("hit");
      mockedExec.mockImplementation(async (commandLine, args, options) => {
        if (commandLine === "sudo" && args?.includes("--no-download")) {
          throw new Error("Cached package is missing");
        }
        if (commandLine === "gfortran" && args?.[0] === "--version") {
          options?.listeners?.stdout?.(
            Buffer.from("GNU Fortran (Ubuntu) 14.2.0"),
          );
        }
        return 0;
      });

      await installDebian(baseInputs);

      expect(core.warning).toHaveBeenCalledWith(
        expect.stringContaining("falling back to an online installation"),
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
        "-o",
        `Dir::Cache::archives=${cacheDir}`,
        "gcc-14",
        "g++-14",
        "gfortran-14",
      ]);
      expect(mockedCache.saveCache).not.toHaveBeenCalled();
    });

    it("falls back when cached tools fail validation", async () => {
      mockedCache.restoreCache.mockResolvedValue("hit");
      let validationAttempts = 0;
      mockedExec.mockImplementation(async (commandLine, args, options) => {
        if (commandLine === "gcc-14" && args?.[0] === "--version") {
          validationAttempts++;
          if (validationAttempts === 1) {
            throw new Error("Invalid cached compiler");
          }
        }
        if (commandLine === "gfortran" && args?.[0] === "--version") {
          options?.listeners?.stdout?.(
            Buffer.from("GNU Fortran (Ubuntu) 14.2.0"),
          );
        }
        return 0;
      });

      await installDebian(baseInputs);

      expect(validationAttempts).toBe(2);
      expect(core.warning).toHaveBeenCalledWith(
        expect.stringContaining("incomplete or invalid"),
      );
    });

    it("continues when cache restore fails", async () => {
      mockedCache.restoreCache.mockRejectedValue(
        new Error("Cache unavailable"),
      );

      await installDebian(baseInputs);

      expect(core.warning).toHaveBeenCalledWith(
        expect.stringContaining("proceeding without it"),
      );
      expect(mockedCache.saveCache).toHaveBeenCalled();
    });

    it("retries apt-get install on failure and eventually succeeds", async () => {
      let attempts = 0;
      mockedExec.mockImplementation(async (cmd, args) => {
        if (
          cmd === "sudo" &&
          args?.includes("apt-get") &&
          args?.includes("install") &&
          !args?.includes("--no-download")
        ) {
          attempts++;
          if (attempts === 1) throw new Error("Apt failure");
        }
        return 0;
      });

      jest.useFakeTimers();
      const installPromise = installDebian(baseInputs);

      // Flush microtasks to allow the first attempt to fail and reach the setTimeout
      for (let i = 0; i < 10; i++) await Promise.resolve();

      // Fast-forward past the 10s delay for the first retry
      jest.advanceTimersByTime(10000);

      // Flush microtasks to allow the second attempt to run
      for (let i = 0; i < 10; i++) await Promise.resolve();

      await installPromise;
      jest.useRealTimers();

      expect(attempts).toBe(2);
      expect(core.warning).toHaveBeenCalledWith(
        expect.stringContaining("apt-get install failed (attempt 1/3)"),
      );
    });

    it("retries add-apt-repository on failure and eventually succeeds", async () => {
      const inputs = { ...baseInputs, version: "15", osVersion: "24.04" };
      let attempts = 0;
      mockedExec.mockImplementation(async (cmd, args) => {
        if (cmd === "sudo" && args?.[0] === "add-apt-repository") {
          attempts++;
          if (attempts === 1) throw new Error("PPA failure");
        }
        return 0;
      });

      jest.useFakeTimers();
      const installPromise = installDebian(inputs);

      // Flush microtasks
      for (let i = 0; i < 10; i++) await Promise.resolve();

      // Fast-forward past the 5s delay for the first retry
      jest.advanceTimersByTime(5000);

      // Flush microtasks
      for (let i = 0; i < 10; i++) await Promise.resolve();

      await installPromise;
      jest.useRealTimers();

      expect(attempts).toBe(2);
      expect(core.warning).toHaveBeenCalledWith(
        expect.stringContaining("add-apt-repository failed (attempt 1/3)"),
      );
    });

    it("configures update-alternatives", async () => {
      await installDebian(baseInputs);

      expect(mockedExec).toHaveBeenCalledWith("sudo", [
        "update-alternatives",
        "--install",
        "/usr/bin/gcc",
        "gcc",
        "/usr/bin/gcc-14",
        "100",
        "--slave",
        "/usr/bin/gfortran",
        "gfortran",
        "/usr/bin/gfortran-14",
      ]);
    });

    it("exports environment variables", async () => {
      await installDebian(baseInputs);
    });
  });
});
