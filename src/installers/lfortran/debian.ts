import * as core from "@actions/core";
import * as exec from "@actions/exec";
import * as fs from "fs";
import * as path from "path";
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
//   - lfortran is installed via conda-forge, so the version here is the conda
//     package version (e.g. "0.63.0").
//   - conda-forge only publishes lfortran for linux-64; linux-aarch64 is
//     currently not supported (https://anaconda.org/conda-forge/lfortran).
//   - The binary is always named `lfortran` regardless of version.
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
} as const satisfies Partial<Record<Arch, readonly string[]>>;

// Downloads and installs a self-contained Miniforge installer into a temporary
// prefix, then uses it to create a conda env with lfortran from conda-forge.
//
// We avoid installing into $CONDA_PREFIX or any pre-existing conda environment
// to prevent interference with other runner toolchains.
export async function installDebian(
  inputs: Inputs,
): Promise<InstallationResult> {
  if (inputs.arch === Arch.ARM64) {
    throw new Error(
      `LFortran is not available for Linux ARM64 on conda-forge. ` +
        `See https://anaconda.org/conda-forge/lfortran for supported platforms.`,
    );
  }

  const version = resolveVersion(inputs, SUPPORTED_VERSIONS);

  core.info(`Installing LFortran ${version} on Linux (${inputs.arch})...`);

  const environment = lfortranEnvironment(inputs, version);
  const miniforge = resolveMiniforgeInstaller(OS.Linux, inputs.arch);
  if (await isReusableLFortranEnvironment(environment, version)) {
    core.info(`Reusing LFortran ${version} from ${environment.envPrefix}.`);
  } else {
    resetLFortranEnvironment(environment);
    const tempDir = createInstallerTempDir();
    const miniforgeInstaller = path.join(tempDir, "miniforge.sh");
    try {
      core.info(`Downloading pinned Miniforge from ${miniforge.url}...`);
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

  core.addPath(environment.binDir);
  core.exportVariable(
    "LFORTRAN_OMP_LIB_DIR",
    path.join(environment.envPrefix, "lib"),
  );

  const resolvedVersion = await resolveInstalledVersion(environment.lfortran);
  core.info(`LFortran ${resolvedVersion} installed successfully.`);
  const result = {
    version: resolvedVersion,
    fc: "lfortran",
    cc: "clang",
    cxx: "clang++",
  };
  return result;
}

async function resolveInstalledVersion(binaryPath: string): Promise<string> {
  let output = "";
  await exec.exec(binaryPath, ["--version"], {
    listeners: {
      stdout: (data: Buffer) => {
        output += data.toString();
      },
    },
  });
  return output.trim();
}
