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
//   LLVM 23 replaced the NSIS .exe installers with WiX .msi installers
//   (LLVM-<patch>-win64.msi / LLVM-<patch>-woa64.msi) carrying the same
//   toolchain, flang included. The .msi payload is extracted with an
//   `msiexec /a` administrative install because 7-Zip cannot resolve the
//   WiX file table (it only exposes the embedded cabinet with mangled names).
//
// UCRT64 (MSYS2/pacman rolling release):
//   x64 only — MSYS2 does not support ARM64.
//   Version is always LATEST since pacman tracks the rolling release.
//
// Only major versions are listed for Native. Full patch versions (e.g. "23.1.0")
// are validated by extracting the major and checking it against this table.
export const SUPPORTED_VERSIONS = {
  [Arch.X64]: {
    [Msystem.Native]: ["23", "22"],
    [Msystem.UCRT64]: [LATEST],
    [Msystem.Clang64]: [LATEST],
  },
  [Arch.ARM64]: {
    [Msystem.Native]: ["23", "22", "21", "20"],
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

// LLVM 23 switched the Windows installer format from NSIS (.exe) to WiX (.msi).
function installerExtension(major: number): string {
  return major >= 23 ? "msi" : "exe";
}

// Extracts an LLVM installer into destDir and returns the directory that holds
// the install tree (bin/, lib/, ...).
//
//   .exe (LLVM 22 and earlier): NSIS payload; 7-Zip extraction places bin/ at
//        the destination root.
//   .msi (LLVM 23+): WiX package; the `msiexec /a` administrative install
//        extracts via the file table without registering anything, and adds a
//        single top-level `LLVM` directory (CPack's INSTALL_ROOT).
//
// The caller declares which flavor it downloaded: tc.downloadTool saves to an
// extensionless GUID path when no destination is given, so the file name
// cannot be used for dispatch (7-Zip then "extracts" the WiX package into
// mangled flat cabinet entries instead of the install tree).
async function extractInstaller(
  installerPath: string,
  destDir: string,
  isMsi: boolean,
): Promise<string> {
  if (isMsi) {
    core.info("Extracting installer with msiexec administrative install...");
    await exec.exec("msiexec", [
      "/a",
      installerPath,
      "/qn",
      `TARGETDIR=${destDir}`,
    ]);

    const installDir = path.join(destDir, "LLVM");
    if (!fs.existsSync(path.join(installDir, "bin"))) {
      throw new Error(
        `msiexec administrative install did not produce the expected layout ` +
          `(missing ${path.join(installDir, "bin")}).`,
      );
    }
    return installDir;
  }

  const sevenZip = "C:\\Program Files\\7-Zip\\7z.exe";
  core.info("Extracting installer with 7-Zip...");
  await exec.exec(`"${sevenZip}"`, ["x", installerPath, `-o${destDir}`, "-y"]);
  return destDir;
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
  const majorNum = parseInt(major, 10);
  const isMsi = majorNum >= 23;
  const filename = `LLVM-${patch}-${suffix}.${installerExtension(majorNum)}`;
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
    // Download under the real installer filename into a dedicated directory:
    // tc.downloadTool would otherwise return an extensionless GUID path, and
    // the extraction directory must not contain the installer itself because
    // for the .exe path that whole directory is what gets tool-cached.
    const tempDownloadDir = path.join(
      process.env.RUNNER_TEMP ?? "C:\\Temp",
      `flang-download-${patch}`,
    );
    const tempExtractDir = path.join(
      process.env.RUNNER_TEMP ?? "C:\\Temp",
      `flang-extract-${patch}`,
    );
    fs.mkdirSync(tempDownloadDir, { recursive: true });
    fs.mkdirSync(tempExtractDir, { recursive: true });

    core.info(`Downloading ${filename}...`);
    const downloadPath = await tc.downloadTool(
      downloadUrl,
      path.join(tempDownloadDir, filename),
    );
    if (expectedSha256) {
      await verifySha256(downloadPath, expectedSha256);
    }

    const installDir = await extractInstaller(
      downloadPath,
      tempExtractDir,
      isMsi,
    );

    core.info("Caching...");
    toolRoot = await tc.cacheDir(
      installDir,
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

  // The MSYS2 flang package only lists llvm-openmp as an optional dependency;
  // without it -fopenmp fails to link (omp_lib modules and libomp are missing).
  await setupMSYS2(inputs.msystem, ["flang", "llvm-openmp"]);

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
