import * as core from "@actions/core";
import * as exec from "@actions/exec";
import * as cache from "@actions/cache";
import * as tc from "@actions/tool-cache";
import { lookup } from "node:dns/promises";
import { Arch, type InstallationResult, type Inputs } from "../../types";
import { resolveVersion } from "../../resolve_version";
import * as fs from "fs";
import path from "path";
import {
  saveCompilerCache,
  validateRestoredCompilerCache,
} from "../../cache_validation";
import { verifySha256 } from "../../verify_download";

// Intel dropped ifort support starting with the 2024 oneAPI release.
// NOTE: Intel's macOS download GUIDs change frequently. These are the standard
// known releases, but if you hit a 403, the GUID in the URL needs updating.
// sha256 is of the downloaded DMG itself (computed locally, not published by
// Intel) — it guards against a corrupted or tampered download, not against a
// GUID rotation upstream.
//
// Mapping: https://www.intel.com/content/www/us/en/developer/articles/tool/compilers-redistributable-libraries-by-version.html
const IFORT_RELEASES = [
  {
    version: "2021.10",
    url: "https://registrationcenter-download.intel.com/akdlm/IRC_NAS/edb4dc2f-266f-47f2-8d56-21bc7764e119/m_HPCKit_p_2023.2.0.49443_offline.dmg",
    sha256: "a17790161712632605f50c37fc8462112ec9947993f9124d0aad53bc055d8fb2",
  },
  {
    version: "2021.9",
    url: "https://registrationcenter-download.intel.com/akdlm/IRC_NAS/a99cb1c5-5af6-4824-9811-ae172d24e594/m_HPCKit_p_2023.1.0.44543_offline.dmg",
    sha256: "57fb765918f0ffa04061e371220a6af5ba137a164c845882d57532a949a54e30",
  },
  {
    version: "2021.8",
    url: "https://registrationcenter-download.intel.com/akdlm/IRC_NAS/19086/m_HPCKit_p_2023.0.0.25440_offline.dmg",
    sha256: "471883e466ca5df2a6a2eb12487d8d8430e3f217aeb4491a77caba7983d18a21",
  },
  {
    version: "2021.6",
    url: "https://registrationcenter-download.intel.com/akdlm/IRC_NAS/18681/m_HPCKit_p_2022.2.0.158_offline.dmg",
    sha256: "da7a4ad396543a144e3db17935d8d307a18e571d4a5992ebdb5d3948d1f4ed8a",
  },
  {
    version: "2021.5",
    url: "https://registrationcenter-download.intel.com/akdlm/IRC_NAS/18341/m_HPCKit_p_2022.1.0.86_offline.dmg",
    sha256: "c215cc7be7530fe0a60f4bda43923226d41f88a296134852252076a740a205c0",
  },
  {
    version: "2021.3",
    url: "https://registrationcenter-download.intel.com/akdlm/IRC_NAS/17890/m_HPCKit_p_2021.3.0.3226_offline.dmg",
    sha256: "e9d1f0720551326c57e5277a7761689b919107d8ec82e500328fb92d87ffa811",
  },
  {
    version: "2021.2",
    url: "https://registrationcenter-download.intel.com/akdlm/IRC_NAS/17643/m_HPCKit_p_2021.2.0.2903_offline.dmg",
    sha256: "496be1ac1d60d2563831532c2e02aded9d6418b40ea297657d4348a9486a7d55",
  },
  {
    version: "2021.1",
    url: "https://registrationcenter-download.intel.com/akdlm/IRC_NAS/17398/m_HPCKit_p_2021.1.0.2681_offline.dmg",
    sha256: "8f0e59f04e0549cc64c2d06b02e63e907e1914ab89a02fddcc6aa70c4a17cd27",
  },
] as const;

export const SUPPORTED_VERSIONS = {
  [Arch.X64]: IFORT_RELEASES.map((r) => r.version),
  [Arch.ARM64]: IFORT_RELEASES.map((r) => r.version),
} as const satisfies Record<Arch, readonly string[] | undefined>;

const ONEAPI_ROOT = "/opt/intel/oneapi";
const SETVARS_SH = `${ONEAPI_ROOT}/setvars.sh`;

async function waitForDnsResolution(
  url: string,
  maxAttempts = 25,
  delayMs = 15_000,
): Promise<void> {
  const host = new URL(url).hostname;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      await lookup(host);
      return;
    } catch {
      if (attempt === maxAttempts) {
        throw new Error(
          `Could not resolve ${host} after ${maxAttempts.toString()} attempts.`,
        );
      }
      core.info(
        `Could not resolve ${host} (attempt ${attempt.toString()}/${maxAttempts.toString()}), retrying in ${(delayMs / 1000).toString()}s...`,
      );
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
}

async function downloadInstaller(
  url: string,
  destPath: string,
): Promise<string> {
  // Runner DNS can blip (ENOTFOUND) while the endpoint itself is healthy, and
  // the retry loops below burn through in about a minute. Wait for the
  // download host to resolve first so a short blip does not fail the install.
  await waitForDnsResolution(url);

  const maxTcAttempts = 3;

  for (let attempt = 1; attempt <= maxTcAttempts; attempt++) {
    try {
      core.info(
        `Downloading via tool-cache (attempt ${attempt.toString()}/${maxTcAttempts.toString()})...`,
      );
      return await tc.downloadTool(url, destPath);
    } catch (error) {
      core.info(
        `tc.downloadTool failed (attempt ${attempt.toString()}/${maxTcAttempts.toString()}): ${String(error)}`,
      );
      if (attempt < maxTcAttempts) {
        await new Promise((resolve) => setTimeout(resolve, 3000 * attempt));
      }
    }
  }

  core.info(
    "tc.downloadTool failed after all attempts. Falling back to curl...",
  );
  await exec.exec("curl", [
    "-sS",
    "-L",
    "--fail",
    "--retry",
    "5",
    "--retry-delay",
    "5",
    "--connect-timeout",
    "30",
    "--max-time",
    "600",
    "-o",
    destPath,
    url,
  ]);

  return destPath;
}

async function ensureRosetta(): Promise<void> {
  const probe = await exec.exec("arch", ["-x86_64", "/usr/bin/true"], {
    ignoreReturnCode: true,
    silent: true,
  });
  if (probe === 0) {
    core.info("Rosetta 2 is available; ifort will run as an x86_64 binary.");
    return;
  }

  core.info("Rosetta 2 is not installed; installing it via softwareupdate...");
  await exec.exec("sudo", [
    "softwareupdate",
    "--install-rosetta",
    "--agree-to-license",
  ]);
}

async function runInstaller(installScript: string): Promise<void> {
  const args = [
    installScript,
    "-s",
    "--action",
    "install",
    "--eula",
    "accept",
    "--ignore-errors",
    "--components",
    "intel.oneapi.mac.ifort-compiler",
  ];
  const maxAttempts = 3;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      await exec.exec("sudo", args);
      return;
    } catch (error) {
      if (attempt === maxAttempts) {
        throw error;
      }
      const delaySeconds = attempt * 10;
      core.info(
        `ifort installer failed (attempt ${attempt.toString()}/${maxAttempts.toString()}): ${String(error)}. ` +
          `Retrying in ${delaySeconds.toString()} seconds...`,
      );
      await new Promise((resolve) => setTimeout(resolve, delaySeconds * 1000));
    }
  }
}

export async function installDarwin(
  inputs: Inputs,
): Promise<InstallationResult> {
  const version = resolveVersion(inputs, SUPPORTED_VERSIONS);

  const release = IFORT_RELEASES.find((r) => r.version === version);
  if (!release) {
    throw new Error(`No installer URL found for ifort ${version} on macOS.`);
  }

  core.info(`Installing ifort ${version} on macOS (${inputs.arch})...`);

  if (inputs.arch === Arch.ARM64) {
    await ensureRosetta();
    // The companion clang builds arm64 objects by default on these runners;
    // they must be x86_64 to link with ifort under Rosetta.
    for (const name of ["CFLAGS", "CXXFLAGS", "LDFLAGS"] as const) {
      const value = [process.env[name], "-arch x86_64"]
        .filter(Boolean)
        .join(" ");
      core.exportVariable(name, value);
      process.env[name] = value;
    }
  }

  const cacheKey = `ifort-darwin-validated-v1-${inputs.arch}-${version}`;
  const cachePaths = [ONEAPI_ROOT];

  // 1. Ensure directory exists AND set ownership to current runner user
  // (Prevents gtar extraction failure during cache restoration)
  if (!fs.existsSync(ONEAPI_ROOT)) {
    await exec.exec("sudo", ["mkdir", "-p", ONEAPI_ROOT]);
  }
  const currentUser = process.env.USER ?? "runner";
  await exec.exec("sudo", ["chown", "-R", currentUser, ONEAPI_ROOT]);

  // 2. Restore from cache if present
  const cacheHit = await cache.restoreCache(cachePaths, cacheKey);
  const cacheValid = cacheHit
    ? await validateRestoredCompilerCache(
        `ifort ${version}`,
        [SETVARS_SH],
        "bash",
        ["-c", `source "${SETVARS_SH}" --force && ifort --version`],
      )
    : false;
  if (cacheValid) {
    core.info(
      `Restored ifort installation from cache (${cacheHit ?? cacheKey}).`,
    );
  } else {
    if (cacheHit) {
      await exec.exec("sudo", ["rm", "-rf", ONEAPI_ROOT]);
      await exec.exec("sudo", ["mkdir", "-p", ONEAPI_ROOT]);
      await exec.exec("sudo", ["chown", "-R", currentUser, ONEAPI_ROOT]);
    }
    core.info(`Downloading ifort DMG installer...`);
    const targetPath = path.join(
      process.env.RUNNER_TEMP ?? "/tmp",
      `ifort-${version}.dmg`,
    );

    const dmgPath = await downloadInstaller(release.url, targetPath);
    core.info("Verifying checksum...");
    await verifySha256(dmgPath, release.sha256);
    core.info("Verifying the downloaded DMG integrity...");
    await exec.exec("hdiutil", ["verify", dmgPath]);

    const mountPoint = "/Volumes/Intel_oneAPI_Installer";

    try {
      core.info("Mounting DMG...");
      await exec.exec("hdiutil", [
        "attach",
        dmgPath,
        "-mountpoint",
        mountPoint,
        "-quiet",
        "-nobrowse",
      ]);

      let installScript = path.join(
        mountPoint,
        "bootstrapper.app",
        "Contents",
        "MacOS",
        "bootstrapper",
      );
      if (!fs.existsSync(installScript)) {
        installScript = path.join(
          mountPoint,
          "bootstrapper.app",
          "Contents",
          "MacOS",
          "install.sh",
        );
      }
      if (!fs.existsSync(installScript)) {
        installScript = path.join(mountPoint, "install.sh");
      }

      core.info(`Running silent install via ${installScript}...`);
      await runInstaller(installScript);

      core.info("Saving installation to cache...");
      await saveCompilerCache(cachePaths, cacheKey);
    } finally {
      core.info("Unmounting DMG...");
      await exec.exec("hdiutil", ["detach", mountPoint, "-force"], {
        ignoreReturnCode: true,
      });
    }
  }

  core.info(`Sourcing ${SETVARS_SH} and exporting environment...`);

  let envOutput = "";
  await exec.exec("bash", ["-c", `source "${SETVARS_SH}" --force && env`], {
    listeners: {
      stdout: (data: Buffer) => {
        envOutput += data.toString();
      },
    },
  });

  for (const line of envOutput.split("\n")) {
    const eqIdx = line.indexOf("=");
    if (eqIdx === -1) continue;
    const key = line.substring(0, eqIdx);
    const val = line.substring(eqIdx + 1);

    if (
      /^(PATH|DYLD_LIBRARY_PATH|.*INTEL.*|.*ONEAPI.*|.*MKL.*|MKLROOT|CMPLR_ROOT)$/i.test(
        key,
      )
    ) {
      core.exportVariable(key, val);
      process.env[key] = val;
    }
  }

  const resolvedVersion = await resolveInstalledVersion();
  core.info(`ifort ${resolvedVersion} installed successfully.`);
  // The macOS HPC Kit DMG installs only the Fortran component
  // (intel.oneapi.mac.ifort-compiler). Classic icc/icpc was never shipped on
  // macOS, and the LLVM icx driver lives in the Intel oneAPI Base Kit (not
  // installed here). The companion C/C++ compiler is therefore the system clang
  // provided by the Xcode Command Line Tools.
  return {
    version: resolvedVersion,
    fc: "ifort",
    cc: "clang",
    cxx: "clang++",
  };
}

async function resolveInstalledVersion(): Promise<string> {
  let output = "";
  await exec.exec("ifort", ["--version"], {
    listeners: {
      stdout: (data: Buffer) => {
        output += data.toString();
      },
    },
  });
  // Return the first line which contains the version string
  return output.trim().split("\n")[0];
}
