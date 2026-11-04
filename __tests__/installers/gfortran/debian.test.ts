import * as core from "@actions/core";
import * as exec from "@actions/exec";
import * as cache from "@actions/cache";
import * as crypto from "crypto";
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
    cache: true,
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
  const revision = "14.2.0-4ubuntu2~24.04";
  const debs = [
    `gfortran-14_${revision}_amd64.deb`,
    `gcc-14_${revision}_amd64.deb`,
  ];
  const fingerprintOf = (files: string[]): string =>
    crypto
      .createHash("sha256")
      .update([...files].sort().join("\n"))
      .digest("hex")
      .slice(0, 8);
  const cacheKey = `apt-gfortran-v2-${revision}-${fingerprintOf(debs)}-20.04.6-x64-14`;
  const printUris = (files: string[]): string =>
    files
      .map(
        (f) => `'http://archive.ubuntu.com/pool/${f}' ${f} 1234 SHA512:abc\n`,
      )
      .join("");

  const emitCandidate = (
    commandLine: string,
    args?: string[],
    options?: exec.ExecOptions,
  ): void => {
    if (commandLine === "apt-cache" && args?.[0] === "policy") {
      options?.listeners?.stdout?.(
        Buffer.from(
          `${args[1]}:\n  Installed: (none)\n  Candidate: ${revision}\n`,
        ),
      );
    }
    if (commandLine === "sudo" && args?.includes("--print-uris")) {
      options?.listeners?.stdout?.(Buffer.from(printUris(debs)));
    }
  };

  beforeEach(() => {
    jest.clearAllMocks();
    jest.useRealTimers();
    process.env.RUNNER_TEMP = testRunnerTemp;
    mockedCache.restoreCache.mockResolvedValue(undefined);
    mockedExec.mockImplementation(async (commandLine, args, options) => {
      emitCandidate(commandLine, args, options);
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
        "--no-update",
        "ppa:ubuntu-toolchain-r/test",
      ]);
    });

    it("does not add PPA when needsPpa returns false", async () => {
      const inputs = { ...baseInputs, version: "14", osVersion: "24.04" };
      await installDebian(inputs);

      expect(mockedExec).not.toHaveBeenCalledWith("sudo", [
        "add-apt-repository",
        "--yes",
        "--no-update",
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
        expect.objectContaining({ ignoreReturnCode: true }),
      );
      expect(mockedExec).toHaveBeenCalledWith("sudo", [
        "timeout",
        "--signal=TERM",
        "--kill-after=30s",
        "10m",
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

    it("tolerates apt-get update failures in unrelated repositories", async () => {
      // Simulates the packages.microsoft.com 403 outages seen on GitHub
      // runner images: the toolchain repositories fetch fine, but an
      // unrelated pre-baked repository fails the overall update.
      mockedExec.mockImplementation(async (commandLine, args, options) => {
        if (commandLine === "gfortran" && args?.[0] === "--version") {
          options?.listeners?.stdout?.(
            Buffer.from("GNU Fortran (Ubuntu) 14.2.0"),
          );
        }
        if (
          commandLine === "sudo" &&
          args?.includes("apt-get") &&
          args?.includes("update")
        ) {
          options?.listeners?.stderr?.(
            Buffer.from(
              "E: Failed to fetch https://packages.microsoft.com/ubuntu/24.04/prod/dists/noble/InRelease  403  Forbidden\n",
            ),
          );
          return 100;
        }
        return 0;
      });

      const result = await installDebian(baseInputs);

      expect(result.fc).toBe("gfortran-14");
      expect(core.info).toHaveBeenCalledWith(
        expect.stringContaining("continuing with cached/stale package index"),
      );
    });

    it("retries apt-get update when the toolchain PPA cannot be fetched", async () => {
      const timeoutSpy = jest
        .spyOn(global, "setTimeout")
        .mockImplementation((callback) => {
          if (typeof callback === "function") callback();
          return 0 as unknown as NodeJS.Timeout;
        });

      let updateAttempts = 0;
      mockedExec.mockImplementation(async (commandLine, args, options) => {
        if (commandLine === "gfortran" && args?.[0] === "--version") {
          options?.listeners?.stdout?.(
            Buffer.from("GNU Fortran (Ubuntu) 14.2.0"),
          );
        }
        if (
          commandLine === "sudo" &&
          args?.includes("apt-get") &&
          args?.includes("update")
        ) {
          updateAttempts++;
          if (updateAttempts === 1) {
            options?.listeners?.stderr?.(
              Buffer.from(
                "E: Failed to fetch https://ppa.launchpadcontent.net/ubuntu-toolchain-r/test/ubuntu/dists/noble/InRelease  503  Service Unavailable\n",
              ),
            );
            return 100;
          }
        }
        return 0;
      });

      try {
        await installDebian(baseInputs);
      } finally {
        timeoutSpy.mockRestore();
      }

      expect(updateAttempts).toBe(2); // failed once, succeeded on retry
      expect(core.info).toHaveBeenCalledWith(
        expect.stringContaining("apt-get update failed (attempt 1/3)"),
      );
    });

    it("retries apt-get update when the toolchain PPA fails even on cache hit", async () => {
      // Regression test for https://github.com/fortran-lang/setup-fortran/pull/245#issuecomment-5761437288:
      // a transient 503 from ppa.launchpadcontent.net left the package index
      // without gcc-16, and the old code skipped the update retry because of
      // the cache hit, so both the cached (--no-download) and online installs
      // failed with "Unable to locate package".
      mockedCache.restoreCache.mockImplementation(async (_paths, key) => key);
      const timeoutSpy = jest
        .spyOn(global, "setTimeout")
        .mockImplementation((callback) => {
          if (typeof callback === "function") callback();
          return 0 as unknown as NodeJS.Timeout;
        });

      let updateAttempts = 0;
      mockedExec.mockImplementation(async (commandLine, args, options) => {
        emitCandidate(commandLine, args, options);
        if (commandLine === "gfortran" && args?.[0] === "--version") {
          options?.listeners?.stdout?.(
            Buffer.from("GNU Fortran (Ubuntu) 16.0.0"),
          );
        }
        if (
          commandLine === "sudo" &&
          args?.includes("apt-get") &&
          args?.includes("update")
        ) {
          updateAttempts++;
          if (updateAttempts === 1) {
            options?.listeners?.stderr?.(
              Buffer.from(
                "W: Failed to fetch https://ppa.launchpadcontent.net/ubuntu-toolchain-r/test/ubuntu/dists/noble/main/binary-amd64/Packages  503  Service Unavailable\n",
              ),
            );
            return 100;
          }
        }
        return 0;
      });

      try {
        const inputs = { ...baseInputs, version: "16", osVersion: "24.04" };
        const result = await installDebian(inputs);

        expect(updateAttempts).toBe(2); // failed once, succeeded on retry
        expect(core.info).toHaveBeenCalledWith(
          expect.stringContaining("apt-get update failed (attempt 1/3)"),
        );
        // The refreshed index lets the cached .debs resolve.
        expect(mockedExec).toHaveBeenCalledWith("sudo", [
          "apt-get",
          "install",
          "-y",
          "--no-download",
          "-o",
          expect.stringContaining("Dir::Cache::archives="),
          "gcc-16",
          "g++-16",
          "gfortran-16",
        ]);
        expect(result.fc).toBe("gfortran-16");
      } finally {
        timeoutSpy.mockRestore();
      }
    });

    it("retries update when the PPA warning occurs despite exit code 0", async () => {
      const timeoutSpy = jest
        .spyOn(global, "setTimeout")
        .mockImplementation((callback) => {
          if (typeof callback === "function") callback();
          return 0 as unknown as NodeJS.Timeout;
        });

      let updateAttempts = 0;
      mockedExec.mockImplementation(async (commandLine, args, options) => {
        if (commandLine === "gfortran" && args?.[0] === "--version") {
          options?.listeners?.stdout?.(
            Buffer.from("GNU Fortran (Ubuntu) 16.0.0"),
          );
        }
        if (
          commandLine === "sudo" &&
          args?.includes("apt-get") &&
          args?.includes("update")
        ) {
          updateAttempts++;
          if (updateAttempts === 1) {
            options?.listeners?.stderr?.(
              Buffer.from(
                "W: Failed to fetch https://ppa.launchpadcontent.net/ubuntu-toolchain-r/test/ubuntu/dists/noble/InRelease  503  Service Unavailable\n",
              ),
            );
            return 0;
          }
        }
        return 0;
      });

      try {
        const inputs = { ...baseInputs, version: "16", osVersion: "24.04" };
        const result = await installDebian(inputs);

        expect(updateAttempts).toBe(2);
        expect(core.info).toHaveBeenCalledWith(
          expect.stringContaining("apt-get update failed (attempt 1/3)"),
        );
        expect(result.fc).toBe("gfortran-16");
      } finally {
        timeoutSpy.mockRestore();
      }
    });

    it("does not retry a warning-only failure in an unrelated repository", async () => {
      let updateAttempts = 0;
      mockedExec.mockImplementation(async (commandLine, args, options) => {
        if (commandLine === "gfortran" && args?.[0] === "--version") {
          options?.listeners?.stdout?.(
            Buffer.from("GNU Fortran (Ubuntu) 14.2.0"),
          );
        }
        if (
          commandLine === "sudo" &&
          args?.includes("apt-get") &&
          args?.includes("update")
        ) {
          updateAttempts++;
          options?.listeners?.stderr?.(
            Buffer.from(
              "W: Failed to fetch https://packages.microsoft.com/ubuntu/24.04/prod/dists/noble/InRelease  403  Forbidden\n",
            ),
          );
          return 0;
        }
        return 0;
      });

      await installDebian(baseInputs);

      expect(updateAttempts).toBe(1);
      expect(core.info).not.toHaveBeenCalledWith(
        expect.stringContaining("apt-get update failed"),
      );
    });

    it("separates x64 and ARM64 caches", async () => {
      await installDebian({ ...baseInputs, arch: Arch.ARM64 });

      expect(mockedCache.restoreCache).toHaveBeenCalledWith(
        [expect.stringContaining(path.join("arm64", "14"))],
        `apt-gfortran-v2-${revision}-${fingerprintOf(debs)}-20.04.6-arm64-14`,
      );
    });

    it("appends the CI cache key suffix when set", async () => {
      process.env.SETUP_FORTRAN_CACHE_KEY_SUFFIX = "-123-1";
      try {
        await installDebian(baseInputs);
      } finally {
        delete process.env.SETUP_FORTRAN_CACHE_KEY_SUFFIX;
      }

      expect(mockedCache.restoreCache).toHaveBeenCalledWith(
        [cacheDir],
        `${cacheKey}-123-1`,
      );
    });

    it("reads the candidate and restores the cache after apt-get update", async () => {
      await installDebian(baseInputs);

      const updateCall = mockedExec.mock.calls.findIndex(
        ([cmd, args]) => cmd === "sudo" && args?.includes("update"),
      );
      const policyCall = mockedExec.mock.calls.findIndex(
        ([cmd]) => cmd === "apt-cache",
      );
      const updateOrder = mockedExec.mock.invocationCallOrder[updateCall];
      expect(mockedExec.mock.invocationCallOrder[policyCall]).toBeGreaterThan(
        updateOrder,
      );
      expect(
        mockedCache.restoreCache.mock.invocationCallOrder[0],
      ).toBeGreaterThan(updateOrder);
    });

    it("changes the key when the files to download change", async () => {
      const newerDebs = [...debs, "libgcc-s1_16-20260315-1_amd64.deb"];
      mockedExec.mockImplementation(async (commandLine, args, options) => {
        if (commandLine === "sudo" && args?.includes("--print-uris")) {
          options?.listeners?.stdout?.(Buffer.from(printUris(newerDebs)));
          return 0;
        }
        emitCandidate(commandLine, args, options);
        return 0;
      });

      await installDebian(baseInputs);

      expect(fingerprintOf(newerDebs)).not.toBe(fingerprintOf(debs));
      expect(mockedCache.restoreCache).toHaveBeenCalledWith(
        [cacheDir],
        `apt-gfortran-v2-${revision}-${fingerprintOf(newerDebs)}-20.04.6-x64-14`,
      );
    });

    it.each([
      ["package has no candidate", "gfortran-14:\n  Candidate: (none)\n", 0, 0],
      ["package cannot be queried", "", 100, 0],
      [
        "download list cannot be read",
        `gfortran-14:\n  Candidate: ${revision}\n`,
        0,
        100,
      ],
    ])(
      "skips the cache when the %s",
      async (_name, policyOutput, policyExitCode, printUrisExitCode) => {
        mockedExec.mockImplementation(async (commandLine, args, options) => {
          if (commandLine === "apt-cache") {
            options?.listeners?.stdout?.(Buffer.from(policyOutput));
            return policyExitCode;
          }
          if (commandLine === "sudo" && args?.includes("--print-uris")) {
            return printUrisExitCode;
          }
          return 0;
        });

        await installDebian(baseInputs);

        expect(mockedCache.restoreCache).not.toHaveBeenCalled();
        expect(mockedCache.saveCache).not.toHaveBeenCalled();
        expect(core.info).toHaveBeenCalledWith(
          expect.stringContaining("skipping the package cache"),
        );
      },
    );

    it("skips the cache when there is nothing to download", async () => {
      mockedExec.mockImplementation(async (commandLine, args, options) => {
        if (commandLine === "apt-cache") {
          options?.listeners?.stdout?.(
            Buffer.from(`gfortran-14:\n  Candidate: ${revision}\n`),
          );
          return 0;
        }
        // Nothing listed: every package is already installed.
        return 0;
      });

      await installDebian(baseInputs);

      expect(mockedCache.restoreCache).not.toHaveBeenCalled();
      expect(mockedCache.saveCache).not.toHaveBeenCalled();
      expect(core.info).toHaveBeenCalledWith(
        expect.stringContaining("nothing to download"),
      );
    });

    it("ignores a cache restored under a different key", async () => {
      mockedCache.restoreCache.mockResolvedValue(`${cacheKey}-longer`);
      await installDebian(baseInputs);

      // restoreCache falls back to a prefix match; those packages belong to a
      // different package set, so they must not be installed from.
      expect(mockedExec).not.toHaveBeenCalledWith(
        "sudo",
        expect.arrayContaining(["--no-download"]),
      );
      expect(core.info).toHaveBeenCalledWith(
        expect.stringContaining("ignoring it"),
      );
      expect(mockedCache.saveCache).toHaveBeenCalledWith([cacheDir], cacheKey);
    });

    it("skips restore, cache preparation, and save when caching is disabled", async () => {
      const result = await installDebian({ ...baseInputs, cache: false });

      expect(mockedCache.restoreCache).not.toHaveBeenCalled();
      expect(mockedCache.saveCache).not.toHaveBeenCalled();
      expect(mockedExec).not.toHaveBeenCalledWith(
        "sudo",
        expect.arrayContaining(["chown"]),
      );
      expect(result.cacheHit).toBe(false);
    });

    it("installs from cache on cache hit", async () => {
      mockedCache.restoreCache.mockResolvedValue(cacheKey);
      const result = await installDebian(baseInputs);

      expect(result.cacheHit).toBe(true);
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
        expect.objectContaining({ ignoreReturnCode: true }),
      );
      expect(mockedCache.saveCache).not.toHaveBeenCalled();
    });

    it("falls back to an online install when cached packages are incomplete", async () => {
      mockedCache.restoreCache.mockResolvedValue(cacheKey);
      mockedExec.mockImplementation(async (commandLine, args, options) => {
        emitCandidate(commandLine, args, options);
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

      expect(core.info).toHaveBeenCalledWith(
        expect.stringContaining("falling back to an online installation"),
      );
      expect(mockedExec).toHaveBeenCalledWith("sudo", [
        "timeout",
        "--signal=TERM",
        "--kill-after=30s",
        "10m",
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
      mockedCache.restoreCache.mockResolvedValue(cacheKey);
      let validationAttempts = 0;
      mockedExec.mockImplementation(async (commandLine, args, options) => {
        emitCandidate(commandLine, args, options);
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

      const result = await installDebian(baseInputs);

      expect(result.cacheHit).toBe(false);
      expect(validationAttempts).toBe(2);
      expect(core.info).toHaveBeenCalledWith(
        expect.stringContaining("incomplete or invalid"),
      );
    });

    it("continues when cache restore fails", async () => {
      mockedCache.restoreCache.mockRejectedValue(
        new Error("Cache unavailable"),
      );

      await installDebian(baseInputs);

      expect(core.info).toHaveBeenCalledWith(
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
          !args?.includes("--no-download") &&
          !args?.includes("--print-uris")
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
      expect(core.info).toHaveBeenCalledWith(
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
      expect(core.info).toHaveBeenCalledWith(
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
