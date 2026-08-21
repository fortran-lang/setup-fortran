import * as core from "@actions/core";
import * as exec from "@actions/exec";
import * as path from "path";
import * as fs from "fs";
import * as tc from "@actions/tool-cache";
import {
  Arch,
  LATEST,
  Msystem,
  type InstallationResult,
  type Inputs,
} from "../../types";
import {
  resolveWindowsVersion,
  parseMajorOrPatch,
  resolveLatestPatch,
  verifyAssetExists,
} from "../../resolve_version";
import { setupMSYS2 } from "../../setup_msys2";
import { addMsvcBinFromPath } from "../../setup_msvc";
import { verifySha256 } from "../../verify_download";

// Make sure the versions are always in descending order. The first one will be
// used as the default if no version was specified by the user.
//
// Native (LLVM official installer):
//   x64:   flang.exe was absent from official Windows x64 installers through
//          at least LLVM 21. LLVM 22 is the first confirmed working version.
//   ARM64: flang has been present since LLVM 20 (Linaro maintains the woa64 build).
//
// UCRT64 (MSYS2/pacman rolling release):
//   x64 only — MSYS2 does not support ARM64.
//   Version is always LATEST since pacman tracks the rolling release.
//
// Only major versions are listed for Native. Full patch versions (e.g. "22.1.3")
// are validated by extracting the major and checking it against this table.
const SUPPORTED_VERSIONS = {
  [Arch.X64]: {
    [Msystem.Native]: ["22"],
    [Msystem.UCRT64]: [LATEST],
    [Msystem.Clang64]: [LATEST],
  },
  [Arch.ARM64]: {
    [Msystem.Native]: ["22", "21", "20"],
    [Msystem.UCRT64]: undefined,
    [Msystem.Clang64]: undefined,
  },
} as const satisfies Record<
  Arch,
  Record<Msystem, readonly string[] | undefined>
>;

// Windows installer suffix per arch, as used in official LLVM GitHub releases.
// win64 = x86_64, woa64 = Windows on ARM64.
const WINDOWS_INSTALLER_SUFFIX: Record<Arch, string> = {
  [Arch.X64]: "win64",
  [Arch.ARM64]: "woa64",
};
// Extracts an LLVM NSIS .exe installer using 7-Zip (pre-installed on all
// GitHub Actions Windows runners).
async function extractExe(
  installerPath: string,
  destDir: string,
): Promise<void> {
  const sevenZip = "C:\\Program Files\\7-Zip\\7z.exe";
  core.info("Extracting installer with 7-Zip...");
  await exec.exec(`"${sevenZip}"`, ["x", installerPath, `-o${destDir}`, "-y"]);
}

// Locates the MSVC toolchain and Windows SDK library directories using vswhere
// and adds them to the LIB environment variable so flang's linker backend can
// find libcmt.lib, oldnames.lib, libcpmt.lib, and the Windows SDK libs.
//
// Flang on Windows uses lld-link as its linker, which reads LIB the same way
// MSVC's link.exe does. The GitHub Actions Windows runners have VS installed
// but don't pre-populate LIB for non-MSVC workflows.
async function setupMsvcLibs(arch: Arch): Promise<void> {
  core.info("Locating MSVC and Windows SDK libraries for flang linker...");

  const vswhere =
    "C:\\Program Files (x86)\\Microsoft Visual Studio\\Installer\\vswhere.exe";

  let vsInstallPath = "";
  await exec.exec(
    `"${vswhere}"`,
    ["-latest", "-property", "installationPath"],
    {
      listeners: {
        stdout: (data: Buffer) => {
          vsInstallPath += data.toString();
        },
      },
    },
  );
  vsInstallPath = vsInstallPath.trim();

  if (!vsInstallPath) {
    core.warning(
      "Could not locate Visual Studio via vswhere. Linker may fail to find CRT libs.",
    );
    return;
  }

  core.info(`Found Visual Studio at: ${vsInstallPath}`);

  // Find the latest MSVC tools version (e.g. 14.38.33130).
  const vcToolsRoot = path.join(vsInstallPath, "VC", "Tools", "MSVC");
  const vcVersion = fs
    .readdirSync(vcToolsRoot)
    .filter((d) => /^\d+\.\d+\.\d+$/.test(d))
    .sort()
    .reverse()[0];

  if (!vcVersion) {
    core.warning("Could not find MSVC tools version directory.");
    return;
  }

  const msvcLibDir = path.join(vcToolsRoot, vcVersion, "lib", arch);
  core.info(`MSVC lib dir: ${msvcLibDir}`);

  const hostArch = arch === Arch.ARM64 ? "arm64" : "x64";
  const msvcBinDir = path.join(
    vcToolsRoot,
    vcVersion,
    "bin",
    `Host${hostArch}`,
    arch,
  );
  addMsvcBinFromPath(msvcBinDir);

  // Find the latest Windows SDK version under
  // C:\Program Files (x86)\Windows Kits\10\Lib\<version>\{um,ucrt}\<arch>.
  const winsdk10Root = "C:\\Program Files (x86)\\Windows Kits\\10\\Lib";
  const sdkVersion = fs
    .readdirSync(winsdk10Root)
    .filter((d) => /^\d+\.\d+\.\d+\.\d+$/.test(d))
    .sort()
    .reverse()[0];

  if (!sdkVersion) {
    core.warning("Could not find Windows SDK version directory.");
    return;
  }

  const winsdkUmDir = path.join(winsdk10Root, sdkVersion, "um", arch);
  const winsdkUcrtDir = path.join(winsdk10Root, sdkVersion, "ucrt", arch);
  core.info(`Windows SDK um dir:   ${winsdkUmDir}`);
  core.info(`Windows SDK ucrt dir: ${winsdkUcrtDir}`);

  const existing = process.env.LIB ?? "";
  const libDirs = [msvcLibDir, winsdkUmDir, winsdkUcrtDir]
    .filter(fs.existsSync)
    .join(";");

  core.exportVariable("LIB", existing ? `${libDirs};${existing}` : libDirs);
}

export async function installWin32(
  inputs: Inputs,
): Promise<InstallationResult> {
  switch (inputs.msystem) {
    case Msystem.Native:
      return await installNative(inputs);
    case Msystem.UCRT64:
    case Msystem.Clang64:
      return await installMSYS2(inputs);
  }
}

async function installNative(inputs: Inputs): Promise<InstallationResult> {
  // resolveWindowsVersion handles patch versions internally via resolveVersion.
  // Use its return value — not inputs.version — so that LATEST is expanded to
  // the first supported version before parseMajorOrPatch sees it.
  const resolved = resolveWindowsVersion(inputs, SUPPORTED_VERSIONS, {
    matchMajorIfPatch: true,
  });
  const { major, patch: userPatch } = parseMajorOrPatch(resolved);

  let patch: string;

  if (userPatch !== undefined) {
    patch = userPatch;
  } else {
    patch = await resolveLatestPatch("llvm/llvm-project", major);
  }

  const suffix = WINDOWS_INSTALLER_SUFFIX[inputs.arch];
  const filename = `LLVM-${patch}-${suffix}.exe`;
  const expectedSha256 = await verifyAssetExists(
    "llvm/llvm-project",
    patch,
    filename,
  );
  const downloadUrl = `https://github.com/llvm/llvm-project/releases/download/llvmorg-${patch}/${filename}`;

  core.info(
    `Installing Flang ${major} (${patch}) on Windows (${inputs.arch})...`,
  );

  let toolRoot = tc.find("flang-verified", patch, inputs.arch);

  if (!toolRoot) {
    core.info(`Downloading ${filename}...`);
    const downloadPath = await tc.downloadTool(downloadUrl);
    if (expectedSha256) {
      await verifySha256(downloadPath, expectedSha256);
    }

    const tempExtractDir = path.join(
      process.env.RUNNER_TEMP ?? "C:\\Temp",
      `flang-extract-${patch}`,
    );
    fs.mkdirSync(tempExtractDir, { recursive: true });

    await extractExe(downloadPath, tempExtractDir);

    core.info("Caching...");
    toolRoot = await tc.cacheDir(
      tempExtractDir,
      "flang-verified",
      patch,
      inputs.arch,
    );
  } else {
    core.info(
      `Flang ${patch} found in tool cache at ${toolRoot}, skipping download.`,
    );
  }

  const binDir = path.join(toolRoot, "bin");
  core.addPath(binDir);

  const flangExe = path.join(binDir, "flang.exe");
  const clangExe = path.join(binDir, "clang.exe");
  const clangPPExe = path.join(binDir, "clang++.exe");

  // Add flang's own lib dir to LIB for Fortran runtime libs, then add MSVC
  // and Windows SDK dirs so lld-link can find the CRT (libcmt, oldnames, etc.)
  const flangLibDir = path.join(toolRoot, "lib");
  const existingLib = process.env.LIB ?? "";
  core.exportVariable(
    "LIB",
    existingLib ? `${flangLibDir};${existingLib}` : flangLibDir,
  );

  await setupMsvcLibs(inputs.arch);

  const resolvedVersion = await resolveInstalledVersion(flangExe);
  core.info(`Flang ${resolvedVersion} installed successfully.`);
  const result = {
    version: resolvedVersion,
    fc: flangExe,
    cc: clangExe,
    cxx: clangPPExe,
  };
  return result;
}

async function installMSYS2(inputs: Inputs): Promise<InstallationResult> {
  const version = resolveWindowsVersion(inputs, SUPPORTED_VERSIONS);
  core.info(
    `Installing Flang ${version} on Windows (MSYS2/UCRT64, rolling release)...`,
  );

  // The MSYS2 package for flang in the UCRT64 environment.
  await setupMSYS2(inputs.msystem, ["flang"]);

  const msysRoot = path.join("C:\\msys64", inputs.msystem);
  const msysBin = path.join(msysRoot, "bin");
  const flangExe = path.join(msysBin, "flang.exe");
  const clangExe = path.join(msysBin, "clang.exe");
  const clangPPExe = path.join(msysBin, "clang++.exe");

  core.addPath(msysBin);

  core.exportVariable("WINDOWS_ENV", inputs.msystem);

  const resolvedVersion = await resolveInstalledVersion(flangExe);
  core.info(`Flang ${resolvedVersion} installed successfully via MSYS2.`);
  const result = {
    version: resolvedVersion,
    fc: flangExe,
    cc: clangExe,
    cxx: clangPPExe,
  };
  return result;
}

async function resolveInstalledVersion(flangExe: string): Promise<string> {
  let output = "";
  await exec.exec(flangExe, ["--version"], {
    listeners: {
      stdout: (data: Buffer) => {
        output += data.toString();
      },
    },
  });
  return output.trim();
}
