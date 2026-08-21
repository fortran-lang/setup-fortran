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

// ifort (Intel Fortran Compiler Classic) was discontinued in 2024.
// Only legacy versions (2023 and earlier) are listed here.
// LATEST resolves to the first entry
const IFORT_RELEASES = [
  {
    version: "2021.13",
    url: "https://registrationcenter-download.intel.com/akdlm/IRC_NAS/ea23d696-a77f-4a4a-8996-20d02cdbc48f/w_fortran-compiler_p_2024.2.1.81_offline.exe",
  },
  {
    version: "2021.12",
    url: "https://registrationcenter-download.intel.com/akdlm/IRC_NAS/c95a3b26-fc45-496c-833b-df08b10297b9/w_HPCKit_p_2024.1.0.561_offline.exe",
  },
  {
    version: "2021.11",
    url: "https://registrationcenter-download.intel.com/akdlm/IRC_NAS/3a64aab4-3c35-40ba-bc9c-f80f136a8005/w_fortran-compiler_p_2024.0.2.27_offline.exe",
  },
  {
    version: "2021.10",
    url: "https://registrationcenter-download.intel.com/akdlm/IRC_NAS/1720594b-b12c-4aca-b7fb-a7d317bac5cb/w_fortran-compiler_p_2023.2.1.7_offline.exe",
  },
  {
    version: "2021.9",
    url: "https://registrationcenter-download.intel.com/akdlm/IRC_NAS/2a13d966-fcc5-4a66-9fcc-50603820e0c9/w_HPCKit_p_2023.1.0.46357_offline.exe",
  },
  {
    version: "2021.8",
    url: "https://registrationcenter-download.intel.com/akdlm/irc_nas/19086/m_HPCKit_p_2023.0.0.25440_offline.exe",
  },
  {
    version: "2021.7",
    url: "https://registrationcenter-download.intel.com/akdlm/irc_nas/18857/w_HPCKit_p_2022.3.0.9564_offline.exe",
  },
  {
    version: "2021.6",
    url: "https://registrationcenter-download.intel.com/akdlm/IRC_NAS/18680/w_HPCKit_p_2022.2.0.173_offline.exe",
  },
] as const;

const SUPPORTED_VERSIONS = {
  [Arch.X64]: {
    [Msystem.Native]: IFORT_RELEASES.map((r) => r.version),
    [Msystem.UCRT64]: undefined,
    [Msystem.Clang64]: undefined,
  },
  [Arch.ARM64]: {
    [Msystem.Native]: undefined,
    [Msystem.UCRT64]: undefined,
    [Msystem.Clang64]: undefined,
  },
} satisfies Record<Arch, Record<Msystem, readonly string[] | undefined>>;

const ONEAPI_ROOT = "C:\\Program Files (x86)\\Intel\\oneAPI";
const SETVARS_BAT = `${ONEAPI_ROOT}\\setvars.bat`;

export async function installWin32(
  inputs: Inputs,
): Promise<InstallationResult> {
  const version = resolveWindowsVersion(inputs, SUPPORTED_VERSIONS);

  const release = IFORT_RELEASES.find((r) => r.version === version);
  if (!release) {
    throw new Error(
      `No installer URL found for ifort ${version} on Windows. ` +
        `This is likely a legacy version issue — please check release compatibility.`,
    );
  }

  core.info(`Installing ifort ${version} on Windows (${inputs.arch})...`);

  const cacheKey = `ifort-win32-validated-v1-${inputs.arch}-${version}`;
  const cachePaths = [ONEAPI_ROOT];

  if (!fs.existsSync(ONEAPI_ROOT)) {
    fs.mkdirSync(ONEAPI_ROOT, { recursive: true });
  }

  const cacheHit = await cache.restoreCache(cachePaths, cacheKey);
  const cacheValid = cacheHit
    ? await validateRestoredCompilerCache(
        `ifort ${version}`,
        [SETVARS_BAT],
        "cmd",
        [
          "/D",
          "/S",
          "/C",
          `call "${SETVARS_BAT}" --force >nul && ifort /what >nul`,
        ],
      )
    : false;
  if (cacheValid) {
    core.info(
      `Restored ifort installation from cache (${cacheHit ?? cacheKey}).`,
    );
  } else {
    if (cacheHit) fs.rmSync(ONEAPI_ROOT, { recursive: true, force: true });
    core.info(`Downloading ifort installer...`);
    const installerPath = await tc.downloadTool(
      release.url,
      path.join(process.env.RUNNER_TEMP ?? "C:\\Temp", `ifort-${version}.exe`),
    );
    await verifyIntelAuthenticode(installerPath);

    core.info("Running silent install (this may take several minutes)...");
    await exec.exec(`"${installerPath}"`, [
      "-s",
      "-a",
      "--silent",
      "--eula",
      "accept",
      "-p=NEED_VS2019_INTEGRATION=0",
      "-p=NEED_VS2022_INTEGRATION=0",
    ]);

    core.info("Saving installation to cache...");
    await saveCompilerCache(cachePaths, cacheKey);
  }

  // Create a temporary batch file to capture the environment variables
  const batFile = path.join(os.tmpdir(), "setvars_ifort_dump.bat");

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
  core.info(`ifort ${resolvedVersion} installed successfully.`);
  // Intel's classic C++ driver (icl) was discontinued in oneAPI 2024+ and is
  // not installed by the Fortran-only packages used below. Use MSVC's cl,
  // which the vcvars64 environment (initialized by the install step) puts on
  // PATH and which ifort is designed to interoperate with for mixed builds.
  // This mirrors how the macOS installer uses the system clang/clang++.
  const result = {
    version: resolvedVersion,
    fc: "ifort",
    cc: "cl",
    cxx: "cl",
  };
  return result;
}

async function resolveInstalledVersion(): Promise<string> {
  let output = "";
  await exec.exec("ifort", ["/what"], {
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

  // Return the first line of the version output
  return output.trim().split("\r\n")[0] || output.trim();
}
