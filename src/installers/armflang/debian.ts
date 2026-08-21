import * as core from "@actions/core";
import * as exec from "@actions/exec";
import * as cache from "@actions/cache";
import * as crypto from "crypto";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { Arch, type InstallationResult, type Inputs } from "../../types";
import { resolveVersion } from "../../resolve_version";

const SUPPORTED_VERSIONS = {
  [Arch.X64]: undefined,
  [Arch.ARM64]: ["22.1", "21.1", "20.1"],
} as const satisfies Record<Arch, readonly string[] | undefined>;

const PACKAGE = "arm-toolchain-for-linux";
const ARM_ROOT = "/opt/arm";
const INSTALL_DIR = "/opt/arm/arm-toolchain-for-linux";

const CURL_RETRY_ARGS = [
  "-4",
  "-L",
  "--retry",
  "5",
  "--retry-delay",
  "5",
  "--retry-max-time",
  "300",
  "--retry-connrefused",
  "--connect-timeout",
  "30",
  "--max-time",
  "600",
  "-fsSL",
] as const;

const APT_ACQUIRE_OPTS = [
  "-o",
  "Acquire::http::Timeout=120",
  "-o",
  "Acquire::https::Timeout=120",
  "-o",
  "Acquire::Retries=5",
  "-o",
  "DPkg::Lock::Timeout=120",
] as const;

function ubuntuRepository(osVersion: string): {
  release: string;
  codename: string;
} {
  if (osVersion.includes("24.04") || osVersion.includes("ubuntu24")) {
    return { release: "24", codename: "noble" };
  }
  if (osVersion.includes("22.04") || osVersion.includes("ubuntu22")) {
    return { release: "22", codename: "jammy" };
  }
  throw new Error(
    `ArmFlang is only supported on Ubuntu 22.04 and 24.04 (got: ${osVersion}).`,
  );
}

function computeSha256(filePath: string): string {
  const fileBuffer = fs.readFileSync(filePath);
  return crypto.createHash("sha256").update(fileBuffer).digest("hex");
}

interface RepositoryPackageMetadata {
  filename: string;
  sha256: string;
}

function parseRepositoryPackageMetadata(
  packagesIndex: string,
): RepositoryPackageMetadata {
  const normalizedIndex = packagesIndex.replace(/\r\n/g, "\n");
  const stanza = normalizedIndex
    .split(/\n\s*\n/)
    .find((entry) => /^Package: arm-toolchains-repository$/m.test(entry));

  const filename = stanza?.match(/^Filename: (.+)$/m)?.[1]?.trim();
  const sha256 = stanza?.match(/^SHA256: ([a-f0-9]{64})$/m)?.[1]?.trim();

  if (
    !filename ||
    !/^pool\/arm-toolchains-repository_[A-Za-z0-9.+:~_-]+_all\.deb$/.test(
      filename,
    ) ||
    !sha256
  ) {
    throw new Error(
      "Could not resolve valid Arm repository package metadata from the package index.",
    );
  }
  return { filename, sha256 };
}

async function configureCurrentRepository(codename: string): Promise<void> {
  const repositoryBaseUrl =
    "https://developer.arm.com/packages/arm-toolchains/ubuntu";
  const packagesIndexPath = path.join(
    os.tmpdir(),
    `arm-toolchains-${codename}-Packages`,
  );
  let repositoryPackagePath: string | undefined;

  try {
    await exec.exec("curl", [
      ...CURL_RETRY_ARGS,
      "-o",
      packagesIndexPath,
      `${repositoryBaseUrl}/dists/${codename}/main/binary-arm64/Packages`,
    ]);

    const metadata = parseRepositoryPackageMetadata(
      fs.readFileSync(packagesIndexPath, "utf8"),
    );

    repositoryPackagePath = path.join(
      os.tmpdir(),
      path.basename(metadata.filename),
    );

    await exec.exec("curl", [
      ...CURL_RETRY_ARGS,
      "-o",
      repositoryPackagePath,
      `${repositoryBaseUrl}/${metadata.filename}`,
    ]);

    const actualChecksum = computeSha256(repositoryPackagePath);
    if (actualChecksum !== metadata.sha256) {
      throw new Error(
        `Checksum verification failed for ${path.basename(repositoryPackagePath)}. ` +
          `Expected ${metadata.sha256}, got ${actualChecksum}.`,
      );
    }

    await exec.exec("sudo", ["dpkg", "-i", repositoryPackagePath]);
  } finally {
    fs.rmSync(packagesIndexPath, { force: true });
    if (repositoryPackagePath) {
      fs.rmSync(repositoryPackagePath, { force: true });
    }
  }
}

async function availablePackageVersion(version: string): Promise<string> {
  const output = await exec.getExecOutput("apt-cache", ["madison", PACKAGE]);
  const versions = output.stdout
    .split("\n")
    .map((line) => line.split("|").at(1)?.trim() ?? "")
    .filter((candidate) => candidate.length > 0);

  const match = versions.find(
    (candidate) =>
      candidate === version ||
      candidate.startsWith(`${version}-`) ||
      candidate.startsWith(`${version}.`),
  );

  if (!match) {
    throw new Error(
      `ArmFlang ${version} is not available from the configured Arm repository. ` +
        `Available package versions: ${versions.join(", ") || "none"}`,
    );
  }
  return match;
}

async function aptGetWithRetry(args: string[], maxAttempts = 3): Promise<void> {
  const execOptions = {
    ignoreReturnCode: true,
    env: {
      ...process.env,
      DEBIAN_FRONTEND: "noninteractive",
    },
  };

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const exitCode = await exec.exec(
      "sudo",
      ["apt-get", ...APT_ACQUIRE_OPTS, ...args],
      execOptions,
    );
    if (exitCode === 0) return;

    if (attempt === maxAttempts) {
      throw new Error(
        `apt-get ${args[0] ?? "command"} failed after ${maxAttempts.toString()} attempts ` +
          `with exit code ${exitCode.toString()}.`,
      );
    }

    const delayMs = attempt * 10_000;
    core.warning(
      `apt-get ${args[0] ?? "command"} failed ` +
        `(attempt ${attempt.toString()}/${maxAttempts.toString()}). ` +
        `Retrying in ${(delayMs / 1000).toString()} seconds...`,
    );
    await new Promise((resolve) => setTimeout(resolve, delayMs));
  }
}

function findLibraryDirectories(baseDir: string): string[] {
  const results: string[] = [];
  if (!fs.existsSync(baseDir)) return results;

  const candidateDirs = [
    path.join(baseDir, "lib"),
    path.join(baseDir, "lib64"),
  ];

  for (const candidate of candidateDirs) {
    if (fs.existsSync(candidate)) {
      results.push(candidate);
    }
  }

  try {
    const entries = fs.readdirSync(baseDir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory()) {
        const subLib = path.join(baseDir, entry.name, "lib");
        const subLib64 = path.join(baseDir, entry.name, "lib64");
        if (fs.existsSync(subLib)) results.push(subLib);
        if (fs.existsSync(subLib64)) results.push(subLib64);
      }
    }
  } catch {
    // Ignore unreadable subdirectories
  }

  return Array.from(new Set(results));
}

function exportEnvVariable(name: string, value: string): void {
  core.exportVariable(name, value);
  process.env[name] = value;
}

function prependEnvPath(name: string, newPaths: string[]): void {
  if (newPaths.length === 0) return;
  const existingValue = process.env[name];
  const existing = existingValue ? existingValue.split(path.delimiter) : [];
  const combined = Array.from(new Set([...newPaths, ...existing])).filter(
    Boolean,
  );
  const result = combined.join(path.delimiter);
  exportEnvVariable(name, result);
}

async function restoreInstallationFromCache(cacheDir: string): Promise<void> {
  core.info("Restoring Arm Toolchain and ArmPL under /opt/arm...");
  await exec.exec("sudo", ["mkdir", "-p", ARM_ROOT]);
  await exec.exec("sudo", ["cp", "-a", `${cacheDir}/.`, ARM_ROOT]);
}

async function stageInstallationForCache(cacheDir: string): Promise<void> {
  core.info("Staging Arm Toolchain and ArmPL for caching...");
  await exec.exec("sudo", ["rm", "-rf", cacheDir]);
  await exec.exec("sudo", ["mkdir", "-p", cacheDir]);
  await exec.exec("sudo", ["cp", "-a", `${ARM_ROOT}/.`, cacheDir]);
  await exec.exec("sudo", ["chown", "-R", os.userInfo().username, cacheDir]);
}

export async function installDebian(
  inputs: Inputs,
): Promise<InstallationResult> {
  const version = resolveVersion(inputs, SUPPORTED_VERSIONS);
  const repository = ubuntuRepository(inputs.osVersion);
  const legacyBaseUrl =
    `https://developer.arm.com/packages/arm-toolchains:ubuntu-${repository.release}` +
    `/${repository.codename}`;
  const keyring = "/usr/share/keyrings/obs-oss-arm-com.gpg";
  const sourceList = "/etc/apt/sources.list.d/obs-oss-arm-com.list";
  const cacheDir = path.join(os.homedir(), ".armflang-cache");
  const cacheKey = `armflang-${version}-${inputs.arch}-${inputs.osVersion}`;

  core.info(`Installing ArmFlang ${version} on Linux (${inputs.arch})...`);

  const binDir = path.join(INSTALL_DIR, "bin");
  const fc = path.join(binDir, "armflang");
  const cc = path.join(binDir, "armclang");
  const cxx = path.join(binDir, "armclang++");

  const cacheHit = await cache.restoreCache([cacheDir], cacheKey);
  let isCacheValid = false;
  if (cacheHit) {
    await restoreInstallationFromCache(cacheDir);
    const libDirs = findLibraryDirectories(ARM_ROOT);
    const hasArmMath = libDirs.some(
      (dir) =>
        fs.existsSync(path.join(dir, "libamath.so")) ||
        fs.existsSync(path.join(dir, "libamath.a")),
    );
    isCacheValid = [fc, cc, cxx].every((binary) => fs.existsSync(binary));
    if (!hasArmMath) {
      core.warning("Cached ArmPL installation does not contain libamath.");
      isCacheValid = false;
    }
  }

  if (isCacheValid) {
    core.info(`Cache hit for ${cacheKey}; skipping package download.`);
  } else {
    if (cacheHit) {
      core.warning(
        `Cache hit occurred for ${cacheKey}, but binaries were incomplete. Re-installing...`,
      );
    }

    await aptGetWithRetry(["update", "-y"]);
    await aptGetWithRetry(["install", "-y", "curl", "gpg"]);

    if (version === "22.1") {
      await configureCurrentRepository(repository.codename);
    } else {
      const releaseKeyPath = path.join(
        os.tmpdir(),
        `arm-toolchains-${repository.codename}-Release.key`,
      );
      try {
        await exec.exec("curl", [
          ...CURL_RETRY_ARGS,
          "-o",
          releaseKeyPath,
          `${legacyBaseUrl}/Release.key`,
        ]);
        await exec.exec("sudo", [
          "gpg",
          "--dearmor",
          "--yes",
          "-o",
          keyring,
          releaseKeyPath,
        ]);
      } finally {
        fs.rmSync(releaseKeyPath, { force: true });
      }
      await exec.exec("sudo", [
        "sh",
        "-c",
        `echo "deb [signed-by=${keyring}] ${legacyBaseUrl}/ ./" > "${sourceList}"`,
      ]);
    }

    await aptGetWithRetry(["update", "-y"]);
    const packageVersion = await availablePackageVersion(version);

    await aptGetWithRetry([
      "install",
      "-y",
      "--no-install-recommends",
      "--fix-missing",
      `${PACKAGE}=${packageVersion}`,
    ]);

    await stageInstallationForCache(cacheDir);
    try {
      await cache.saveCache([cacheDir], cacheKey);
    } catch (err) {
      core.warning(
        `Failed to save ArmFlang installation to cache: ${(err as Error).message}`,
      );
    }
  }

  for (const binary of [fc, cc, cxx]) {
    if (!fs.existsSync(binary)) {
      throw new Error(`Expected Arm Toolchain binary was not found: ${binary}`);
    }
  }

  // 1. Add binary path
  core.addPath(binDir);
  prependEnvPath("PATH", [binDir]);

  // ArmFlang links libamath automatically; ArmPL is a sibling under /opt/arm.
  const libDirs = findLibraryDirectories(ARM_ROOT);
  prependEnvPath("LIBRARY_PATH", libDirs);
  prependEnvPath("LD_LIBRARY_PATH", libDirs);

  let installedVersion = "";
  await exec.exec(fc, ["--version"], {
    listeners: {
      stdout: (data: Buffer) => {
        installedVersion += data.toString();
      },
    },
  });

  return {
    version: installedVersion.trim(),
    fc,
    cc,
    cxx,
  };
}
