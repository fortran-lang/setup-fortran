import * as core from "@actions/core";
import * as exec from "@actions/exec";
import * as cache from "@actions/cache";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { Arch, type InstallationResult } from "../../types";
import { resolveVersion } from "../../resolve_version";
import type { Inputs } from "../../types";
import { indexFetchFailed } from "../../apt_sources";

// Make sure the versions are always in descending order. The first one will be
// used as the default if no version was specified by the user.
export const SUPPORTED_VERSIONS = {
  [Arch.X64]: ["16", "15", "14", "13", "12", "11"],
  [Arch.ARM64]: ["16", "15", "14", "13", "12", "11"],
} as const satisfies Record<Arch, readonly string[]>;

const CACHE_SCHEMA_VERSION = "v2";

function aptCacheKey(inputs: Inputs, version: string): string {
  return [
    "apt-gfortran",
    CACHE_SCHEMA_VERSION,
    inputs.osVersion,
    inputs.arch,
    version,
  ].join("-");
}

function aptCacheDir(inputs: Inputs, version: string): string {
  return path.join(
    process.env.RUNNER_TEMP ?? os.tmpdir(),
    "setup-fortran",
    "apt",
    "gfortran",
    inputs.osVersion,
    inputs.arch,
    version,
  );
}

function aptCacheOptions(cacheDir: string): string[] {
  return ["-o", `Dir::Cache::archives=${cacheDir}`];
}

const APT_TIMEOUT_OPTS: string[] = [
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
];

export async function installDebian(
  inputs: Inputs,
): Promise<InstallationResult> {
  const version = resolveVersion(inputs, SUPPORTED_VERSIONS);
  core.info(`Installing GFortran ${version} on Linux (${inputs.arch})...`);

  const packages = [`gcc-${version}`, `g++-${version}`, `gfortran-${version}`];
  const cacheDir = aptCacheDir(inputs, version);
  const cachePaths = [cacheDir];
  const cacheKey = aptCacheKey(inputs, version);

  // APT expects this directory to exist beneath its archive directory.
  fs.mkdirSync(path.join(cacheDir, "partial"), { recursive: true });
  let cacheHit: string | undefined;
  try {
    cacheHit = await cache.restoreCache(cachePaths, cacheKey);
  } catch (err) {
    core.warning(
      `Could not restore the GFortran package cache; proceeding without it: ${String(err)}`,
    );
  }

  const ppaAdded = needsPpa(version, inputs.osVersion);
  if (ppaAdded) {
    core.info(`Adding PPA for GFortran ${version}...`);
    await addAptRepositoryWithRetry("ppa:ubuntu-toolchain-r/test");
  }

  await aptGetUpdateWithRetry(!!cacheHit, ppaAdded);

  if (cacheHit) {
    core.info(`Cache hit for ${cacheKey}, installing from cache...`);
    try {
      await aptGetInstallFromCache(packages, cacheDir);
      await verifyInstalledToolchain(version);
    } catch (err) {
      core.warning(
        `Cached GFortran packages were incomplete or invalid; ` +
          `falling back to an online installation: ${String(err)}`,
      );
      await aptGetInstallWithRetry(packages, cacheDir);
      await verifyInstalledToolchain(version);
    }
  } else {
    await aptGetInstallWithRetry(packages, cacheDir);
    await verifyInstalledToolchain(version);
    try {
      await prepareCacheForSave(cacheDir);
      await cache.saveCache(cachePaths, cacheKey);
    } catch (err) {
      core.warning(`Could not save the GFortran package cache: ${String(err)}`);
    }
  }

  await exec.exec("sudo", [
    "update-alternatives",
    "--install",
    "/usr/bin/gcc",
    "gcc",
    `/usr/bin/gcc-${version}`,
    "100",
    "--slave",
    "/usr/bin/gfortran",
    "gfortran",
    `/usr/bin/gfortran-${version}`,
  ]);

  const resolvedVersion = await resolveInstalledVersion(version);
  core.info(`GFortran ${resolvedVersion} installed successfully.`);
  const result = {
    version: resolvedVersion,
    fc: `gfortran-${version}`,
    cc: `gcc-${version}`,
    cxx: `g++-${version}`,
  };
  return result;
}

async function aptGetInstallWithRetry(
  packages: string[],
  cacheDir: string,
  maxAttempts = 3,
): Promise<void> {
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      await exec.exec("sudo", [
        "timeout",
        "--signal=TERM",
        "--kill-after=30s",
        "15m",
        "apt-get",
        "install",
        "-y",
        ...APT_TIMEOUT_OPTS,
        ...aptCacheOptions(cacheDir),
        ...packages,
      ]);
      return;
    } catch (err) {
      if (attempt === maxAttempts) throw err;
      core.warning(
        `apt-get install failed (attempt ${attempt.toString()}/${maxAttempts.toString()}), retrying in ${(attempt * 10).toString()}s...`,
      );
      await new Promise((res) => setTimeout(res, attempt * 10_000));
    }
  }
}

async function prepareCacheForSave(cacheDir: string): Promise<void> {
  // APT may leave root-owned lock and partial-download metadata behind. They
  // are not reusable package data and can prevent the cache client from
  // archiving the directory as the unprivileged runner user.
  await exec.exec("sudo", ["chown", "-R", os.userInfo().username, cacheDir]);
  fs.rmSync(path.join(cacheDir, "lock"), { force: true });
  fs.rmSync(path.join(cacheDir, "partial"), {
    recursive: true,
    force: true,
  });
}

async function aptGetUpdateWithRetry(
  cacheHit: boolean,
  ppaAdded: boolean,
  maxAttempts = 3,
): Promise<void> {
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    let output = "";
    const exitCode = await exec.exec(
      "sudo",
      [
        "timeout",
        "--signal=TERM",
        "--kill-after=10s",
        "5m",
        "apt-get",
        "update",
        "-y",
        ...APT_TIMEOUT_OPTS,
      ],
      {
        ignoreReturnCode: true,
        listeners: {
          stdout: (data: Buffer) => {
            output += data.toString();
          },
          stderr: (data: Buffer) => {
            output += data.toString();
          },
        },
      },
    );
    if (exitCode === 0) return;

    // Repositories baked into the runner image that have nothing to do with
    // the toolchain (e.g. packages.microsoft.com returning a transient 403)
    // must not fail the job. Only a fetch failure of the ubuntu-toolchain-r
    // PPA — whose index is required to resolve the gcc packages — is fatal.
    const ppaFetchFailed =
      ppaAdded && indexFetchFailed(output, "ppa.launchpad");
    if (cacheHit || !ppaFetchFailed) {
      core.warning(
        "apt-get update did not complete cleanly; continuing with cached/stale package index.",
      );
      return;
    }

    if (attempt === maxAttempts) {
      throw new Error(
        `apt-get update failed after ${maxAttempts.toString()} attempts with exit code ${exitCode.toString()}.`,
      );
    }
    core.warning(
      `apt-get update failed (attempt ${attempt.toString()}/${maxAttempts.toString()}), retrying in ${(attempt * 10).toString()}s...`,
    );
    await new Promise((res) => setTimeout(res, attempt * 10_000));
  }
}

async function aptGetInstallFromCache(
  packages: string[],
  cacheDir: string,
): Promise<void> {
  await exec.exec("sudo", [
    "apt-get",
    "install",
    "-y",
    "--no-download",
    ...aptCacheOptions(cacheDir),
    ...packages,
  ]);
}

async function verifyInstalledToolchain(version: string): Promise<void> {
  for (const tool of ["gcc", "g++", "gfortran"]) {
    await exec.exec(`${tool}-${version}`, ["--version"], { silent: true });
  }
}

export function needsPpa(version: string, osVersion: string): boolean {
  const v = parseInt(version);
  if (osVersion.includes("24")) return v >= 15;
  if (osVersion.includes("22")) return v >= 13;
  return true;
}

async function addAptRepositoryWithRetry(
  ppa: string,
  maxAttempts = 3,
): Promise<void> {
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      // --no-update: skip add-apt-repository's own package-list refresh (a
      // global update on 22.04 that could trip over unrelated broken repos).
      // The index is refreshed right after by aptGetUpdateWithRetry instead.
      await exec.exec("sudo", [
        "add-apt-repository",
        "--yes",
        "--no-update",
        ppa,
      ]);
      return;
    } catch (err) {
      if (attempt === maxAttempts) throw err;
      core.warning(
        `add-apt-repository failed (attempt ${attempt.toString()}/${maxAttempts.toString()}), retrying in ${(attempt * 10).toString()}s...`,
      );
      await new Promise((res) => setTimeout(res, attempt * 5_000));
    }
  }
}

async function resolveInstalledVersion(version: string): Promise<string> {
  let output = "";
  await exec.exec(`gfortran-${version}`, ["--version"], {
    listeners: {
      stdout: (data: Buffer) => {
        output += data.toString();
      },
    },
  });
  return output.trim();
}
