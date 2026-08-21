import * as core from "@actions/core";
import * as exec from "@actions/exec";
import * as cache from "@actions/cache";
import * as tc from "@actions/tool-cache";
import { Arch, type InstallationResult, type Inputs } from "../../types";
import { resolveVersion } from "../../resolve_version";
import * as fs from "fs";
import path from "path";
import {
  saveCompilerCache,
  validateRestoredCompilerCache,
} from "../../cache_validation";

// Intel dropped ifort support starting with the 2024 oneAPI release.
// NOTE: Intel's macOS download GUIDs change frequently. These are the standard
// known releases, but if you hit a 403, the GUID in the URL needs updating.
//
// Mapping: https://www.intel.com/content/www/us/en/developer/articles/tool/compilers-redistributable-libraries-by-version.html
const IFORT_RELEASES = [
  {
    version: "2021.10",
    url: "https://registrationcenter-download.intel.com/akdlm/IRC_NAS/edb4dc2f-266f-47f2-8d56-21bc7764e119/m_HPCKit_p_2023.2.0.49443.dmg",
  },
  {
    version: "2021.9",
    url: "https://registrationcenter-download.intel.com/akdlm/IRC_NAS/a99cb1c5-5af6-4824-9811-ae172d24e594/m_HPCKit_p_2023.1.0.44543.dmg",
  },
  {
    version: "2021.8",
    url: "https://registrationcenter-download.intel.com/akdlm/irc_nas/19086/m_HPCKit_p_2023.0.0.25440.dmg",
  },
  {
    version: "2021.6",
    url: "https://registrationcenter-download.intel.com/akdlm/IRC_NAS/18681/m_HPCKit_p_2022.2.0.158_offline.dmg",
  },
  {
    version: "2021.5",
    url: "https://registrationcenter-download.intel.com/akdlm/irc_nas/18341/m_HPCKit_p_2022.1.0.86.dmg",
  },
  {
    version: "2021.3",
    url: "https://registrationcenter-download.intel.com/akdlm/irc_nas/17890/m_HPCKit_p_2021.3.0.3226.dmg",
  },
  {
    version: "2021.2",
    url: "https://registrationcenter-download.intel.com/akdlm/irc_nas/17643/m_HPCKit_p_2021.2.0.2903.dmg",
  },
  {
    version: "2021.1",
    url: "https://registrationcenter-download.intel.com/akdlm/irc_nas/17398/m_HPCKit_p_2021.1.0.2681.dmg",
  },
] as const;

const SUPPORTED_VERSIONS = {
  [Arch.X64]: IFORT_RELEASES.map((r) => r.version),
  [Arch.ARM64]: undefined, // GitHub's macos-14+ runners are ARM64 and cannot run ifort
} as const satisfies Record<Arch, readonly string[] | undefined>;

const ONEAPI_ROOT = "/opt/intel/oneapi";
const SETVARS_SH = `${ONEAPI_ROOT}/setvars.sh`;

async function downloadInstaller(
  url: string,
  destPath: string,
): Promise<string> {
  const maxTcAttempts = 3;

  for (let attempt = 1; attempt <= maxTcAttempts; attempt++) {
    try {
      core.info(
        `Downloading via tool-cache (attempt ${attempt.toString()}/${maxTcAttempts.toString()})...`,
      );
      return await tc.downloadTool(url, destPath);
    } catch (error) {
      core.warning(
        `tc.downloadTool failed (attempt ${attempt.toString()}/${maxTcAttempts.toString()}): ${String(error)}`,
      );
      if (attempt < maxTcAttempts) {
        await new Promise((resolve) => setTimeout(resolve, 3000 * attempt));
      }
    }
  }

  core.warning(
    "tc.downloadTool failed after all attempts. Falling back to curl...",
  );
  await exec.exec("curl", [
    "-sS",
    "-L",
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
      core.warning(
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
    throw new Error(
      "Intel Fortran (ifort) does not support Apple Silicon (ARM64). " +
        "Please ensure your workflow uses an x64 runner or Intel environment.",
    );
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
