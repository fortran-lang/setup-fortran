import * as core from "@actions/core";
import * as exec from "@actions/exec";
import * as cache from "@actions/cache";
import * as crypto from "crypto";
import * as fs from "fs";
import { installDebian } from "../../../src/installers/armflang/debian";
import { Arch, Compiler, Msystem, OS, type Inputs } from "../../../src/types";

jest.mock("@actions/core");
jest.mock("@actions/exec");
jest.mock("@actions/cache");
jest.mock("os", () => ({
  ...jest.requireActual("os"),
  homedir: jest.fn().mockReturnValue("/home/user"),
  tmpdir: jest.fn().mockReturnValue("/tmp"),
  userInfo: jest.fn().mockReturnValue({ username: "user" }),
}));
jest.mock("fs", () => ({
  ...jest.requireActual("fs"),
  existsSync: jest.fn(),
  readFileSync: jest.fn(),
  rmSync: jest.fn(),
}));

describe("installDebian (ArmFlang)", () => {
  const mockedExec = exec.exec as jest.MockedFunction<typeof exec.exec>;
  const mockedGetExecOutput = exec.getExecOutput as jest.MockedFunction<
    typeof exec.getExecOutput
  >;
  const mockedFs = fs as jest.Mocked<typeof fs>;
  const mockedCache = cache as jest.Mocked<typeof cache>;

  const inputs: Inputs = {
    compiler: Compiler.ArmFlang,
    version: "22.1",
    os: OS.Linux,
    osVersion: "ubuntu24",
    arch: Arch.ARM64,
    msystem: Msystem.Native,
    cleanupDisk: false,
    updateEnvironment: true,
  };

  beforeEach(() => {
    jest.clearAllMocks();
    mockedFs.existsSync.mockReturnValue(true);
    mockedCache.restoreCache.mockResolvedValue(undefined);
    const packageContents = Buffer.from("repository package");
    const packageChecksum = crypto
      .createHash("sha256")
      .update(packageContents)
      .digest("hex");
    (mockedFs.readFileSync as jest.Mock).mockImplementation(
      (_filePath: string, encoding?: string) =>
        encoding === "utf8"
          ? "Package: arm-toolchains-repository\n" +
            "Version: 2-2~noble\n" +
            "Filename: pool/arm-toolchains-repository_2-2~noble_all.deb\n" +
            `SHA256: ${packageChecksum}\n`
          : packageContents,
    );
    mockedGetExecOutput.mockImplementation(async (command) => {
      if (command === "sha256sum") {
        return {
          stdout: `${"a".repeat(64)}  repository.deb\n`,
          stderr: "",
          exitCode: 0,
        };
      }
      return {
        stdout:
          " arm-toolchain-for-linux | 22.1.0-123 | https://developer.arm.com\n",
        stderr: "",
        exitCode: 0,
      };
    });
    mockedExec.mockImplementation(async (command, args, options) => {
      if (command.endsWith("/armflang") && args?.[0] === "--version") {
        options?.listeners?.stdout?.(Buffer.from("ArmFlang 22.1.0"));
      }
      return 0;
    });
  });

  it("configures the current repository and installs ArmFlang 22.1", async () => {
    await installDebian(inputs);

    expect(mockedExec).toHaveBeenCalledWith(
      "curl",
      expect.arrayContaining([
        expect.stringContaining("arm-toolchains-repository_2-2~noble_all.deb"),
      ]),
    );
    expect(mockedExec).toHaveBeenCalledWith(
      "sudo",
      expect.arrayContaining([
        "apt-get",
        "install",
        "arm-toolchain-for-linux=22.1.0-123",
        "Acquire::Retries=5",
      ]),
      expect.objectContaining({ ignoreReturnCode: true }),
    );
    expect(mockedExec).toHaveBeenCalledWith(
      "curl",
      expect.arrayContaining(["--retry", "5", "--connect-timeout", "30"]),
    );
  });

  it("uses the legacy repository for ArmFlang 21.1", async () => {
    mockedGetExecOutput.mockResolvedValue({
      stdout: " arm-toolchain-for-linux | 21.1-81 | repo\n",
      stderr: "",
      exitCode: 0,
    });

    await installDebian({ ...inputs, version: "21.1" });

    expect(mockedExec).toHaveBeenCalledWith(
      "curl",
      expect.arrayContaining([
        "https://developer.arm.com/packages/arm-toolchains:ubuntu-24/noble/Release.key",
      ]),
    );
  });

  it("stages and saves the installed toolchain on a cache miss", async () => {
    await installDebian(inputs);

    expect(mockedExec).toHaveBeenCalledWith("sudo", [
      "cp",
      "-a",
      "/opt/arm/.",
      "/home/user/.armflang-cache",
    ]);
    expect(mockedCache.saveCache).toHaveBeenCalledWith(
      ["/home/user/.armflang-cache"],
      "armflang-22.1-arm64-ubuntu24",
    );
  });

  it("restores the toolchain and skips all network work on a cache hit", async () => {
    mockedCache.restoreCache.mockResolvedValue("cache-key");

    await installDebian(inputs);

    expect(mockedExec).toHaveBeenCalledWith("sudo", [
      "cp",
      "-a",
      "/home/user/.armflang-cache/.",
      "/opt/arm",
    ]);
    expect(mockedExec).not.toHaveBeenCalledWith("curl", expect.anything());
    expect(mockedExec).not.toHaveBeenCalledWith(
      "sudo",
      expect.arrayContaining(["apt-get"]),
      expect.anything(),
    );
    expect(mockedCache.saveCache).not.toHaveBeenCalled();
  });

  it("reinstalls when a restored cache is incomplete", async () => {
    mockedCache.restoreCache.mockResolvedValue("cache-key");
    let installationReady = false;
    mockedFs.existsSync.mockImplementation((filePath) => {
      const value = String(filePath);
      if (
        value.includes("/bin/armflang") ||
        value.includes("/bin/armclang") ||
        value.includes("libamath")
      ) {
        return installationReady;
      }
      return true;
    });
    mockedExec.mockImplementation(async (command, args, options) => {
      if (
        command === "sudo" &&
        args?.[0] === "apt-get" &&
        args.includes("install") &&
        args.some((arg) => arg.startsWith("arm-toolchain-for-linux="))
      ) {
        installationReady = true;
      }
      if (command.endsWith("/armflang") && args?.[0] === "--version") {
        options?.listeners?.stdout?.(Buffer.from("ArmFlang 22.1.0"));
      }
      return 0;
    });

    await installDebian(inputs);

    expect(core.warning).toHaveBeenCalledWith(
      expect.stringContaining("binaries were incomplete"),
    );
    expect(mockedExec).toHaveBeenCalledWith(
      "curl",
      expect.arrayContaining([
        expect.stringContaining("arm-toolchains-repository"),
      ]),
    );
  });

  it("retries apt operations after a transient failure", async () => {
    const timeoutSpy = jest
      .spyOn(global, "setTimeout")
      .mockImplementation((callback: Parameters<typeof setTimeout>[0]) => {
        callback();
        return 0 as unknown as NodeJS.Timeout;
      });
    let updateAttempts = 0;
    mockedExec.mockImplementation(async (command, args, options) => {
      if (command.endsWith("/armflang") && args?.[0] === "--version") {
        options?.listeners?.stdout?.(Buffer.from("ArmFlang 22.1.0"));
      }
      if (
        command === "sudo" &&
        args?.[0] === "apt-get" &&
        args.includes("update")
      ) {
        updateAttempts++;
        if (updateAttempts === 1) return 100;
      }
      return 0;
    });

    try {
      await installDebian(inputs);
    } finally {
      timeoutSpy.mockRestore();
    }

    expect(updateAttempts).toBe(3);
    expect(core.warning).toHaveBeenCalledWith(
      expect.stringContaining("Retrying in 10 seconds"),
    );
  });

  it("exports absolute compiler paths", async () => {
    const result = await installDebian(inputs);

    expect(core.addPath).toHaveBeenCalledWith(
      "/opt/arm/arm-toolchain-for-linux/bin",
    );
    expect(result).toEqual({
      version: "ArmFlang 22.1.0",
      fc: "/opt/arm/arm-toolchain-for-linux/bin/armflang",
      cc: "/opt/arm/arm-toolchain-for-linux/bin/armclang",
      cxx: "/opt/arm/arm-toolchain-for-linux/bin/armclang++",
    });
  });

  it("rejects x64", async () => {
    await expect(installDebian({ ...inputs, arch: Arch.X64 })).rejects.toThrow(
      "No supported versions found for armflang on linux (x64)",
    );
  });

  it("fails when the requested package version is absent", async () => {
    mockedGetExecOutput.mockImplementation(async (command) => {
      if (command === "sha256sum") {
        return {
          stdout: `${"a".repeat(64)}  repository.deb\n`,
          stderr: "",
          exitCode: 0,
        };
      }
      return {
        stdout: " arm-toolchain-for-linux | 21.1-81 | repo\n",
        stderr: "",
        exitCode: 0,
      };
    });

    await expect(installDebian(inputs)).rejects.toThrow(
      "ArmFlang 22.1 is not available",
    );
  });

  it("rejects a repository package with an invalid checksum", async () => {
    (mockedFs.readFileSync as jest.Mock).mockImplementation(
      (_filePath: string, encoding?: string) =>
        encoding === "utf8"
          ? "Package: arm-toolchains-repository\n" +
            "Filename: pool/arm-toolchains-repository_2-2~noble_all.deb\n" +
            `SHA256: ${"b".repeat(64)}\n`
          : Buffer.from("repository package"),
    );

    await expect(installDebian(inputs)).rejects.toThrow(
      "Checksum verification failed",
    );
    expect(mockedExec).not.toHaveBeenCalledWith(
      "sudo",
      expect.arrayContaining(["dpkg", "-i"]),
    );
  });
});
