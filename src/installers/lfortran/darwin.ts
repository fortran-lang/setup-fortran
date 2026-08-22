import * as core from "@actions/core";
import * as exec from "@actions/exec";
import * as path from "path";
import * as fs from "fs";
import { Arch, OS, type InstallationResult } from "../../types";
import { resolveVersion } from "../../resolve_version";
import type { Inputs } from "../../types";
import { miniforgeInstaller as resolveMiniforgeInstaller } from "../../miniforge";
import { verifySha256 } from "../../verify_download";
import {
  createInstallerTempDir,
  isReusableLFortranEnvironment,
  lfortranEnvironment,
  resetLFortranEnvironment,
} from "../../lfortran_environment";

// Make sure the versions are always in descending order. The first one will be
// used as the default if no version was specified by the user.
//
// Notes:
//   - lfortran is installed via conda-forge on macOS; there is no Homebrew
//     formula and GitHub releases only ship source tarballs.
//   - Both ARM64 (macos-14+) and X64 (macos-13 and earlier) are supported via
//     conda-forge. The conda arch strings are `osx-arm64` and `osx-64`.
//   - LATEST resolves to the first entry in the list.
const SUPPORTED_VERSIONS = {
  [Arch.X64]: [
    "0.64.0",
    "0.63.0",
    "0.62.0",
    "0.61.0",
    "0.60.0",
    "0.59.0",
    "0.58.0",
    "0.57.0",
  ],
  [Arch.ARM64]: [
    "0.64.0",
    "0.63.0",
    "0.62.0",
    "0.61.0",
    "0.60.0",
    "0.59.0",
    "0.58.0",
    "0.57.0",
  ],
} as const satisfies Record<Arch, readonly string[]>;

export async function installDarwin(
  inputs: Inputs,
): Promise<InstallationResult> {
  const version = resolveVersion(inputs, SUPPORTED_VERSIONS);

  core.info(`Installing LFortran ${version} on macOS (${inputs.arch})...`);

  const environment = lfortranEnvironment(inputs, version);
  const miniforge = resolveMiniforgeInstaller(OS.MacOS, inputs.arch);
  if (await isReusableLFortranEnvironment(environment, version)) {
    core.info(`Reusing LFortran ${version} from ${environment.envPrefix}.`);
  } else {
    resetLFortranEnvironment(environment);
    const tempDir = createInstallerTempDir();
    const miniforgeInstaller = path.join(tempDir, "miniforge.sh");
    try {
      await exec.exec("curl", [
        "-fsSL",
        "--retry",
        "3",
        "--retry-delay",
        "15",
        "-o",
        miniforgeInstaller,
        miniforge.url,
      ]);
      await verifySha256(miniforgeInstaller, miniforge.sha256);
      await exec.exec("bash", [
        miniforgeInstaller,
        "-b",
        "-p",
        environment.miniforgePrefix,
      ]);
      await exec.exec(environment.conda, [
        "create",
        "-y",
        "-p",
        environment.envPrefix,
        "-c",
        "conda-forge",
        "--strict-channel-priority",
        `lfortran==${version}`,
      ]);
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  }

  if (!fs.existsSync(environment.lfortran)) {
    throw new Error(
      `lfortran binary not found at expected path: ${environment.lfortran}`,
    );
  }

  core.info(`Found lfortran binary at: ${environment.lfortran}`);

  // Fix rpath of lfortran binary to ensure it can find its shared libraries
  // (like libxeus-zmq) when run outside of a conda environment.
  const libDir = path.join(environment.envPrefix, "lib");
  try {
    await exec.exec("install_name_tool", [
      "-add_rpath",
      libDir,
      environment.lfortran,
    ]);
  } catch (e) {
    core.debug(`install_name_tool failed: ${String(e)}`);
  }

  core.addPath(environment.binDir);
  core.exportVariable("LFORTRAN_OMP_LIB_DIR", libDir);
  // As an additional safety measure, set DYLD_FALLBACK_LIBRARY_PATH.
  // Note: we use fallback to avoid overriding system libraries if possible.
  core.exportVariable("DYLD_FALLBACK_LIBRARY_PATH", libDir);

  // lfortran links against system libc++ on macOS; set SDKROOT so the linker
  // can find the right SDK headers when compiling generated C/C++ code.
  let sdkPath = "";
  try {
    await exec.exec("xcrun", ["--show-sdk-path"], {
      listeners: {
        stdout: (data: Buffer) => {
          sdkPath += data.toString().trim();
        },
      },
    });
    if (sdkPath) core.exportVariable("SDKROOT", sdkPath);
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    core.warning(`Could not determine SDKROOT via xcrun: ${error}`);
  }

  const resolvedVersion = await resolveInstalledVersion(
    environment.conda,
    environment.envPrefix,
  );
  core.info(`LFortran ${resolvedVersion} installed successfully on macOS.`);
  const result = {
    version: resolvedVersion,
    fc: environment.lfortran,
    cc: "clang",
    cxx: "clang++",
  };
  return result;
}

async function resolveInstalledVersion(
  condaBin: string,
  condaPrefix: string,
): Promise<string> {
  let output = "";
  await exec.exec(
    condaBin,
    ["run", "-p", condaPrefix, "lfortran", "--version"],
    {
      listeners: {
        stdout: (data: Buffer) => {
          output += data.toString();
        },
      },
    },
  );
  return output.trim();
}
