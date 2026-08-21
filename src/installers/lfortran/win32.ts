import * as core from "@actions/core";
import * as exec from "@actions/exec";
import * as path from "path";
import * as fs from "fs";
import {
  Arch,
  LATEST,
  Msystem,
  OS,
  type InstallationResult,
  type Inputs,
} from "../../types";
import { resolveWindowsVersion } from "../../resolve_version";
import { setupMSYS2 } from "../../setup_msys2";
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
// Native (conda-forge, default):
//   Both x64 and ARM64. Conda-forge is the only source that provides current
//   versioned lfortran binaries for Windows. The Miniforge installer is a
//   native .exe that runs without MSYS2 or WSL.
//
// UCRT64 (MSYS2/pacman, rolling release):
//   x64 only — MSYS2 does not support ARM64. Version is always LATEST since
//   pacman tracks the rolling release. The UCRT64 lfortran package tracks
//   upstream closely (verified at 0.63.0).
const SUPPORTED_VERSIONS = {
  [Arch.X64]: {
    [Msystem.Native]: [
      "0.64.0",
      "0.63.0",
      "0.62.0",
      "0.61.0",
      "0.60.0",
      "0.59.0",
      "0.58.0",
      "0.57.0",
    ],
    [Msystem.UCRT64]: [LATEST],
    [Msystem.Clang64]: [LATEST],
  },
  [Arch.ARM64]: {
    [Msystem.Native]: undefined,
    [Msystem.UCRT64]: undefined,
    [Msystem.Clang64]: undefined,
  },
} as const satisfies Record<
  Arch,
  Record<Msystem, readonly string[] | undefined>
>;

export async function installWin32(
  inputs: Inputs,
): Promise<InstallationResult> {
  switch (inputs.msystem) {
    case Msystem.Native:
      return await installConda(inputs);
    case Msystem.UCRT64:
    case Msystem.Clang64:
      return await installMSYS2(inputs);
  }
}

// Installs lfortran via Miniforge/conda-forge. This is the only install path
// on Windows for both x64 and ARM64.
//
// Conda's directory layout on Windows differs from Linux/macOS:
//   lfortran.exe lives in <prefix>\ (the prefix root itself), not bin\.
//   Scripts\ holds Python entry-point wrappers; Library\bin\ holds DLLs.
//   All three need to be on PATH for the toolchain to work correctly.
async function installConda(inputs: Inputs): Promise<InstallationResult> {
  const version = resolveWindowsVersion(inputs, SUPPORTED_VERSIONS);

  core.info(
    `Installing LFortran ${version} on Windows (${inputs.arch}) via conda-forge...`,
  );

  const environment = lfortranEnvironment(inputs, version);
  const miniforge = resolveMiniforgeInstaller(OS.Windows, inputs.arch);
  if (await isReusableLFortranEnvironment(environment, version)) {
    core.info(`Reusing LFortran ${version} from ${environment.envPrefix}.`);
  } else {
    resetLFortranEnvironment(environment);
    const tempDir = createInstallerTempDir();
    const miniforgeInstaller = path.join(tempDir, "miniforge-install.exe");
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
      await exec.exec(miniforgeInstaller, [
        "/S",
        `/D=${environment.miniforgePrefix}`,
      ]);
      await exec.exec(environment.conda, [
        "create",
        "-y",
        "-p",
        environment.envPrefix,
        "-c",
        "conda-forge",
        "--solver=classic",
        `lfortran==${version}`,
        "lld",
      ]);
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  }

  if (!fs.existsSync(environment.lfortran)) {
    throw new Error(
      `lfortran.exe not found at expected path: ${environment.lfortran}`,
    );
  }

  core.addPath(environment.envPrefix);
  core.addPath(path.join(environment.envPrefix, "Scripts"));
  core.addPath(environment.binDir);

  const lldLink = path.join(environment.binDir, "lld-link.exe");
  const proxyLink = path.join(environment.binDir, "link.exe");

  if (fs.existsSync(lldLink)) {
    if (!fs.existsSync(proxyLink)) {
      core.info("Creating link.exe proxy for lld-link.exe...");
      try {
        // We copy instead of symlink to avoid potential permission issues on Windows
        fs.copyFileSync(lldLink, proxyLink);
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        core.warning(`Could not create link.exe proxy: ${message}`);
      }
    }
    // Export the proxy as the preferred linker
    core.info(`Setting LFORTRAN_LINKER to ${proxyLink}`);
    core.exportVariable("LFORTRAN_LINKER", proxyLink);
  } else {
    core.warning(
      "lld-link.exe not found; LFortran may fail to link on Windows.",
    );
  }

  core.exportVariable(
    "LFORTRAN_OMP_LIB_DIR",
    path.join(environment.envPrefix, "Library", "lib"),
  );

  const resolvedVersion = await resolveInstalledVersion(environment.lfortran);
  core.info(
    `LFortran ${resolvedVersion} installed successfully on Windows (conda).`,
  );
  // The companion C/C++ compiler is the system `clang`/`clang++` on PATH,
  // matching the macOS/Linux lfortran installers. The `lfortran` conda-forge
  // package does not ship clang, but GitHub Windows runners provide LLVM on
  // PATH, so the companion-compiler check resolves it. This keeps the action
  // consistent across platforms.
  const result = {
    version: resolvedVersion,
    fc: environment.lfortran,
    cc: "clang",
    cxx: "clang++",
  };
  return result;
}

// Installs lfortran via MSYS2 (rolling release).
// The binary lives in C:\msys64\<msystem>\bin\lfortran.exe.
async function installMSYS2(inputs: Inputs): Promise<InstallationResult> {
  const version = resolveWindowsVersion(inputs, SUPPORTED_VERSIONS);
  core.info(
    `Installing LFortran ${version} on Windows (MSYS2/${inputs.msystem}, rolling release)...`,
  );

  const msysBin = path.join("C:\\msys64", inputs.msystem, "bin");
  const lfortranExe = path.join(msysBin, "lfortran.exe");
  let resolvedVersion: string | undefined;
  if (fs.existsSync(lfortranExe)) {
    try {
      resolvedVersion = await resolveInstalledVersion(lfortranExe);
      core.info(
        `Reusing existing LFortran ${resolvedVersion} from ${lfortranExe}.`,
      );
    } catch (error) {
      core.warning(
        `Existing MSYS2 LFortran is unusable; reinstalling it: ${String(error)}`,
      );
    }
  }

  if (!resolvedVersion) {
    await setupMSYS2(inputs.msystem, ["lfortran"]);
    if (!fs.existsSync(lfortranExe)) {
      throw new Error(
        `lfortran.exe not found at expected path: ${lfortranExe}`,
      );
    }
    resolvedVersion = await resolveInstalledVersion(lfortranExe);
  }

  core.addPath(msysBin);

  core.exportVariable(
    "LFORTRAN_OMP_LIB_DIR",
    path.join("C:\\msys64", inputs.msystem, "lib"),
  );
  core.exportVariable("WINDOWS_ENV", inputs.msystem);

  core.info(
    `LFortran ${resolvedVersion} installed successfully on Windows (MSYS2/${inputs.msystem}).`,
  );
  const result = {
    version: resolvedVersion,
    fc: lfortranExe,
    cc: path.join(msysBin, "clang.exe"),
    cxx: path.join(msysBin, "clang++.exe"),
  };
  return result;
}

async function resolveInstalledVersion(binaryPath: string): Promise<string> {
  let output = "";
  await exec.exec(`"${binaryPath}"`, ["--version"], {
    listeners: {
      stdout: (data: Buffer) => {
        output += data.toString();
      },
    },
  });
  return output.trim();
}
