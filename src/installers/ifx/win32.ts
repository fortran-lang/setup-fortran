import * as core from "@actions/core";
import * as exec from "@actions/exec";
import * as cache from "@actions/cache";
import * as tc from "@actions/tool-cache";
import {
  Arch,
  Msystem,
  type InstallationResult,
  type Inputs,
} from "../../types";
import { resolveWindowsVersion } from "../../resolve_version";
import * as fs from "fs";
import * as os from "os";
import path from "path";
import { addMsvcBinFromPath } from "../../setup_msvc";
import { verifyIntelAuthenticode } from "../../verify_download";
import {
  saveCompilerCache,
  validateRestoredCompilerCache,
} from "../../cache_validation";

// Only versions with a known installer URL are listed.
// LATEST resolves to the first entry.
const IFX_RELEASES = [
  {
    version: "2026.1.1",
    url: "https://registrationcenter-download.intel.com/akdlm/IRC_NAS/a43777b7-be5a-4fb6-97f9-bf4ae49eeb33/intel-fortran-compiler-2026.1.1.20_offline.exe",
  },
  {
    version: "2026.1.0",
    url: "https://registrationcenter-download.intel.com/akdlm/IRC_NAS/fe796a48-cd17-4b7b-b5ad-445b36d42f0f/intel-fortran-compiler-2026.1.0.101_offline.exe",
  },
  {
    version: "2026.0.0",
    url: "https://registrationcenter-download.intel.com/akdlm/IRC_NAS/9af38d13-867b-45af-a950-0b42d9bac1ae/intel-fortran-compiler-2026.0.0.566_offline.exe",
  },
  {
    version: "2025.3.3",
    url: "https://registrationcenter-download.intel.com/akdlm/IRC_NAS/11a7fdc4-e14d-42b0-a48b-9a4777932c31/intel-fortran-compiler-2025.3.3.16_offline.exe",
  },
  {
    version: "2025.3.2",
    url: "https://registrationcenter-download.intel.com/akdlm/IRC_NAS/039121f2-d488-4bc1-a5bb-97528e3a4b86/intel-fortran-compiler-2025.3.2.26_offline.exe",
  },
  {
    version: "2025.3.1",
    url: "https://registrationcenter-download.intel.com/akdlm/IRC_NAS/36f868e9-84b3-4b4f-90ef-ca84092cae6a/intel-oneapi-hpc-toolkit-2025.3.1.54_offline.exe",
  },
  {
    version: "2025.3.0",
    url: "https://registrationcenter-download.intel.com/akdlm/IRC_NAS/cb54db79-1d73-4443-8274-d712fdc2d156/intel-fortran-compiler-2025.3.0.324_offline.exe",
  },
  {
    version: "2025.2.1",
    url: "https://registrationcenter-download.intel.com/akdlm/IRC_NAS/0dc56e76-d2c0-4bb8-9c83-c2ee3952b855/intel-fortran-compiler-2025.2.1.11_offline.exe",
  },
  {
    version: "2025.2.0",
    url: "https://registrationcenter-download.intel.com/akdlm/IRC_NAS/d500a63b-e481-465d-b1a3-64a6981d25f1/intel-fortran-compiler-2025.2.0.535_offline.exe",
  },
  {
    version: "2025.1.0",
    url: "https://registrationcenter-download.intel.com/akdlm/IRC_NAS/9962ffec-17a2-4135-94e5-acc3995e0c49/intel-fortran-compiler-2025.1.0.602_offline.exe",
  },
  {
    version: "2025.0.4",
    url: "https://registrationcenter-download.intel.com/akdlm/IRC_NAS/1269b58a-590e-49b1-9f53-beebe171ac56/intel-fortran-compiler-2025.0.4.19_offline.exe",
  },
  {
    version: "2025.0.3",
    url: "https://registrationcenter-download.intel.com/akdlm/IRC_NAS/ead426f0-5403-412f-9652-106156965748/intel-fortran-compiler-2025.0.3.11_offline.exe",
  },
  {
    version: "2025.0.1",
    url: "https://registrationcenter-download.intel.com/akdlm/IRC_NAS/a37c30c3-a846-4371-a85d-603e9a9eb94c/intel-oneapi-hpc-toolkit-2025.0.1.48_offline.exe",
  },
  {
    version: "2025.0.0",
    url: "https://registrationcenter-download.intel.com/akdlm/IRC_NAS/90dfd1ee-cbde-4461-89fc-3d4a4587844c/intel-fortran-compiler-2025.0.0.712_offline.exe",
  },
  {
    version: "2024.2.1",
    url: "https://registrationcenter-download.intel.com/akdlm/IRC_NAS/ea23d696-a77f-4a4a-8996-20d02cdbc48f/w_fortran-compiler_p_2024.2.1.81_offline.exe",
  },
  {
    version: "2024.2.0",
    url: "https://registrationcenter-download.intel.com/akdlm/IRC_NAS/7feb5647-59dd-420d-8753-345d31e177dc/w_fortran-compiler_p_2024.2.0.424_offline.exe",
  },
  {
    version: "2024.1.0",
    url: "https://registrationcenter-download.intel.com/akdlm/IRC_NAS/c95a3b26-fc45-496c-833b-df08b10297b9/w_HPCKit_p_2024.1.0.561_offline.exe",
  },
  {
    version: "2024.0.2",
    url: "https://registrationcenter-download.intel.com/akdlm/IRC_NAS/3a64aab4-3c35-40ba-bc9c-f80f136a8005/w_fortran-compiler_p_2024.0.2.27_offline.exe",
  },
  {
    version: "2024.0.1",
    url: "https://registrationcenter-download.intel.com/akdlm/IRC_NAS/7a6db8a1-a8b9-4043-8e8e-ca54b56c34e4/w_HPCKit_p_2024.0.1.35_offline.exe",
  },
  {
    version: "2023.2.1",
    url: "https://registrationcenter-download.intel.com/akdlm/IRC_NAS/1720594b-b12c-4aca-b7fb-a7d317bac5cb/w_fortran-compiler_p_2023.2.1.7_offline.exe",
  },
  {
    version: "2023.2.0",
    url: "https://registrationcenter-download.intel.com/akdlm/IRC_NAS/438527fc-7140-422c-a851-389f2791816b/w_HPCKit_p_2023.2.0.49441_offline.exe",
  },
  {
    version: "2023.1.0",
    url: "https://registrationcenter-download.intel.com/akdlm/IRC_NAS/2a13d966-fcc5-4a66-9fcc-50603820e0c9/w_HPCKit_p_2023.1.0.46357_offline.exe",
  },
  {
    version: "2022.3.0",
    url: "https://registrationcenter-download.intel.com/akdlm/irc_nas/18857/w_HPCKit_p_2022.3.0.9564_offline.exe",
  },
  {
    version: "2022.2.0",
    url: "https://registrationcenter-download.intel.com/akdlm/IRC_NAS/18680/w_HPCKit_p_2022.2.0.173_offline.exe",
  },
] as const;

const SUPPORTED_VERSIONS = {
  [Arch.X64]: {
    [Msystem.Native]: IFX_RELEASES.map((r) => r.version),
    [Msystem.UCRT64]: undefined,
    [Msystem.Clang64]: undefined,
  },
  [Arch.ARM64]: {
    [Msystem.Native]: undefined,
    [Msystem.UCRT64]: undefined,
    [Msystem.Clang64]: undefined,
  },
} satisfies Record<Arch, Record<Msystem, readonly string[] | undefined>>;

const LEGACY_KIT_VERSIONS = new Set([
  "2022.2.0",
  "2022.3.0",
  "2023.1.0",
  "2023.2.0",
]);

const ONEAPI_ROOT = "C:\\Program Files (x86)\\Intel\\oneAPI";
const SETVARS_BAT = `${ONEAPI_ROOT}\\setvars.bat`;

export async function installWin32(
  inputs: Inputs,
): Promise<InstallationResult> {
  const version = resolveWindowsVersion(inputs, SUPPORTED_VERSIONS, {
    resolveMinorToLatestPatch: true,
  });

  const release = IFX_RELEASES.find((r) => r.version === version);
  if (!release) {
    throw new Error(
      `No installer URL found for ifx ${version} on Windows. ` +
        `This is a bug — please open an issue.`,
    );
  }

  core.info(`Installing ifx ${version} on Windows (${inputs.arch})...`);

  const cacheKey = `ifx-win32-validated-v1-${inputs.arch}-${version}`;
  const cachePaths = [ONEAPI_ROOT];

  if (!fs.existsSync(ONEAPI_ROOT)) {
    fs.mkdirSync(ONEAPI_ROOT, { recursive: true });
  }

  let cacheHit: string | undefined;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      cacheHit = await cache.restoreCache(cachePaths, cacheKey); // Sometimes fails
      break;
    } catch (err) {
      if (attempt === 3) {
        core.warning(
          `Cache restore failed after 3 attempts, proceeding with fresh install: ${String(err)}`,
        );
        break;
      }
      core.warning(
        `Cache restore failed (attempt ${attempt.toString()}/3), retrying in ${(attempt * 15).toString()}s...`,
      );
      await new Promise((res) => setTimeout(res, attempt * 10_000));
    }
  }

  const cacheValid = cacheHit
    ? await validateRestoredCompilerCache(
        `ifx ${version}`,
        [SETVARS_BAT],
        "cmd",
        [
          "/D",
          "/S",
          "/C",
          `call "${SETVARS_BAT}" --force >nul && ifx --version >nul`,
        ],
      )
    : false;

  if (cacheValid) {
    core.info(
      `Restored ifx installation from cache (${cacheHit ?? cacheKey}).`,
    );
  } else {
    if (cacheHit) fs.rmSync(ONEAPI_ROOT, { recursive: true, force: true });
    core.info(`Downloading installer...`);
    const installerPath = await downloadToolWithRetry(
      release.url,
      path.join(process.env.RUNNER_TEMP ?? "C:\\Temp", `ifx-${version}.exe`),
    );

    core.info("Verifying installer...");
    await verifyIntelAuthenticode(installerPath);

    core.info("Running silent install...");
    const extraArgs: string[] = [];
    if (supportsComponentFilter(version, release.url)) {
      const componentId = await resolveFortranComponentId(installerPath);
      if (componentId) {
        extraArgs.push(`--components=${componentId}`);
      }
    }
    await runInstallerWithRetry(installerPath, extraArgs);

    core.info("Saving installation to cache...");
    await saveCompilerCache(cachePaths, cacheKey);
  }

  // Create a temporary batch file to capture the environment variables
  const batFile = path.join(os.tmpdir(), "setvars_and_dump.bat");

  fs.writeFileSync(
    batFile,
    [
      `@echo off`,
      `:: 1. Find MSVC Installation Path via vswhere`,
      `for /f "usebackq tokens=*" %%i in (\`"%ProgramFiles(x86)%\\Microsoft Visual Studio\\Installer\\vswhere.exe" -latest -property installationPath\`) do set VS_INSTALL_DIR=%%i`,

      `:: 2. Initialize MSVC Environment Natively`,
      `if exist "%VS_INSTALL_DIR%\\VC\\Auxiliary\\Build\\vcvars64.bat" call "%VS_INSTALL_DIR%\\VC\\Auxiliary\\Build\\vcvars64.bat"`,

      `:: 3. Call Intel's setvars.bat (it will detect MSVC is already active)`,
      `call "${SETVARS_BAT}" --force`,

      `:: 4. Dump the fully combined environment`,
      `set`,
    ].join("\r\n"),
  );

  let envOutput = "";
  await exec.exec("cmd", ["/C", batFile], {
    listeners: {
      stdout: (data: Buffer) => {
        envOutput += data.toString();
      },
    },
  });

  for (const line of envOutput.split("\n")) {
    const eqIdx = line.indexOf("=");
    if (eqIdx === -1) continue;
    const key = line.substring(0, eqIdx).trim();
    const val = line.substring(eqIdx + 1).trimEnd();

    if (
      /^(PATH|LIB|INCLUDE|.*INTEL.*|.*ONEAPI.*|.*MKL.*|MKLROOT|CMPLR_ROOT)$/i.test(
        key,
      )
    ) {
      if (key.toUpperCase() === "PATH") {
        // Keep the filter to remove Git's link.exe to prevent "extra operand" errors.
        // Since vcvars64.bat already prepended MSVC's link.exe to the PATH,
        // we no longer need the secondary TypeScript vswhere lookup.
        const filteredPath = val
          .split(";")
          .filter((p) => !p.toLowerCase().includes("git\\usr\\bin"))
          .join(";");
        core.exportVariable("PATH", filteredPath);
        addMsvcBinFromPath(filteredPath);
      } else {
        core.exportVariable(key, val);
      }
    }
  }

  const resolvedVersion = await resolveInstalledVersion();
  core.info(`ifx ${resolvedVersion} installed successfully.`);
  // The LLVM C/C++ drivers (icx/icpx) are only shipped by the HPC Kit
  // installers; the Fortran-only packages used below do not include them.
  // Use MSVC's cl, which the vcvars64 environment (initialized by the
  // install step) puts on PATH and which ifx interoperates with for mixed
  // builds. This mirrors how the macOS installer uses the system clang/clang++
  // and how installWin32 for ifort advertises cl on Windows.
  const result = {
    version: resolvedVersion,
    fc: "ifx",
    cc: "cl",
    cxx: "cl",
  };
  return result;
}

async function downloadToolWithRetry(
  url: string,
  destination: string,
  maxAttempts = 3,
): Promise<string> {
  let lastError: unknown;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await tc.downloadTool(url, destination);
    } catch (error) {
      lastError = error;

      fs.rmSync(destination, { force: true });

      if (attempt === maxAttempts) break;

      const delaySeconds = attempt * 20;

      core.warning(
        `Download failed (attempt ${attempt.toString()}/${maxAttempts.toString()}), ` +
          `retrying in ${delaySeconds.toString()}s: ${String(error)}`,
      );

      await new Promise((resolve) => setTimeout(resolve, delaySeconds * 1000));
    }
  }

  throw lastError;
}

function isFullKitInstaller(url: string): boolean {
  return /hpckit|hpc-toolkit/i.test(url);
}

function supportsComponentFilter(version: string, url: string): boolean {
  return isFullKitInstaller(url) && !LEGACY_KIT_VERSIONS.has(version);
}

async function resolveFortranComponentId(
  installerPath: string,
): Promise<string | undefined> {
  let output = "";
  await exec.exec(`"${installerPath}"`, ["-s", "-a", "--list-components"], {
    listeners: {
      stdout: (data: Buffer) => {
        output += data.toString();
      },
    },
  });

  const line = output.split("\n").find((l) => /ifort-compiler/i.test(l));
  if (!line) {
    core.info(
      "This installer doesn't expose the Fortran compiler as a separately " +
        "installable component; installing the full kit instead.",
    );
    return undefined;
  }

  const id = line.trim().split(/\s+/)[0];
  if (!id) {
    throw new Error(`Failed to parse component ID from line: "${line}"`);
  }
  return id;
}

async function runInstallerWithRetry(
  installerPath: string,
  extraArgs: string[] = [],
  maxAttempts = 3,
): Promise<void> {
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const exitCode = await exec.exec(
      `"${installerPath}"`,
      [
        "-s",
        "-a",
        "--silent",
        "--eula",
        "accept",
        "-p=NEED_VS2019_INTEGRATION=0",
        "-p=NEED_VS2022_INTEGRATION=0",
        ...extraArgs,
      ],
      { ignoreReturnCode: true },
    );

    // 0 = Success, 1001 = Already installed
    if (exitCode === 0 || exitCode === 1001) {
      if (exitCode === 1001) {
        core.info("Intel oneAPI is already installed, skipping.");
      }
      return;
    }

    if (attempt === maxAttempts) {
      throw new Error(`Installer failed with exit code ${exitCode.toString()}`);
    }

    core.warning(
      `Installer crashed with exit code ${exitCode.toString()} (attempt ${attempt.toString()}/${maxAttempts.toString()}), retrying in ${(attempt * 15).toString()}s...`,
    );
    await new Promise((res) => setTimeout(res, attempt * 15_000));
  }
}

async function resolveInstalledVersion(): Promise<string> {
  const versionCommand = "-V";

  let output = "";
  await exec.exec("ifx", [versionCommand], {
    ignoreReturnCode: true,
    listeners: {
      stdout: (data: Buffer) => {
        output += data.toString();
      },
      stderr: (data: Buffer) => {
        output += data.toString();
      },
    },
  });
  return output.trim();
}
