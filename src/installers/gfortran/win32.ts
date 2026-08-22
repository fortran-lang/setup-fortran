import * as core from "@actions/core";
import * as exec from "@actions/exec";
import * as path from "path";
import * as tc from "@actions/tool-cache";
import {
  Arch,
  LATEST,
  Msystem,
  type InstallationResult,
  type Inputs,
} from "../../types";
import { resolveWindowsVersion } from "../../resolve_version";
import { setupMSYS2 } from "../../setup_msys2";
import { verifySha256 } from "../../verify_download";

// Make sure the versions are in descending order. The first one will be
// used as the default if no version was specified by the user.
const GCC_RELEASES = [
  {
    version: "16",
    url: "https://github.com/brechtsanders/winlibs_mingw/releases/download/16.1.0posix-14.0.0-ucrt-r1/winlibs-x86_64-posix-seh-gcc-16.1.0-mingw-w64ucrt-14.0.0-r1.zip",
    sha256: "325771f545e89f62c0e1fafdbf0066cc49e3321aeca7b704c8d065e97a72f2fb",
  },
  {
    version: "15",
    url: "https://github.com/brechtsanders/winlibs_mingw/releases/download/15.2.0posix-14.0.0-ucrt-r7/winlibs-x86_64-posix-seh-gcc-15.2.0-mingw-w64ucrt-14.0.0-r7.zip",
    sha256: "cb2fbad6162540cdf5e1facdce08d4dac359e8cf64f7f696a99274291763b815",
  },
  {
    version: "14",
    url: "https://github.com/brechtsanders/winlibs_mingw/releases/download/14.3.0posix-12.0.0-ucrt-r1/winlibs-x86_64-posix-seh-gcc-14.3.0-mingw-w64ucrt-12.0.0-r1.zip",
    sha256: "d6e83bf3cfff02ddcb4ccb485a8a162e3852bf09976d0cb9d521f3d0d6855ea3",
  },
  {
    version: "13",
    url: "https://github.com/brechtsanders/winlibs_mingw/releases/download/13.3.0posix-11.0.1-ucrt-r1/winlibs-x86_64-posix-seh-gcc-13.3.0-mingw-w64ucrt-11.0.1-r1.zip",
    sha256: "6c90485da4d9966683a83a1e5f3a0b1084d2a5ba2e57e8b27c0634afe3983776",
  },
  {
    version: "12",
    url: "https://github.com/brechtsanders/winlibs_mingw/releases/download/12.4.0posix-12.0.0-ucrt-r1/winlibs-x86_64-posix-seh-gcc-12.4.0-mingw-w64ucrt-12.0.0-r1.zip",
    sha256: "5f8c427e555c3dc93364b83a107aca914774eda213acf42fe16dcd45bac91ff2",
  },
  {
    version: "11",
    url: "https://github.com/brechtsanders/winlibs_mingw/releases/download/11.5.0posix-12.0.0-ucrt-r1/winlibs-x86_64-posix-seh-gcc-11.5.0-mingw-w64ucrt-12.0.0-r1.zip",
    sha256: "cee970ee45be022e79f5b3409c41e0a37b3bf45f17c00343cb31ae7b2874e501",
  },
] as const;

const SUPPORTED_VERSIONS = {
  [Arch.X64]: {
    [Msystem.Native]: GCC_RELEASES.map((r) => r.version),
    [Msystem.UCRT64]: [LATEST],
    [Msystem.Clang64]: undefined,
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
  const version = resolveWindowsVersion(inputs, SUPPORTED_VERSIONS);

  switch (inputs.msystem) {
    case Msystem.Native:
      return await installNative(inputs, version);
    case Msystem.UCRT64:
      return await installMSYS2(inputs);
    case Msystem.Clang64:
      throw new Error(
        `Clang/LLVM's clang-cl does not include gfortran and is not supported by this installer. ` +
          `Please use the "native" msystem to install the latest gfortran via conda-forge, or ` +
          `use MSYS2 with msystem "ucrt64" for a rolling-release version of gfortran.`,
      );
  }
}

async function installNative(
  inputs: Inputs,
  version: string,
): Promise<InstallationResult> {
  const release = GCC_RELEASES.find((r) => r.version === version);
  if (!release) {
    throw new Error(`Unsupported GFortran version: ${version}`);
  }
  const downloadUrl = release.url;

  let toolRoot = tc.find(
    `gfortran-verified-${inputs.msystem}`,
    version,
    inputs.arch,
  );

  if (!toolRoot) {
    core.info(`Downloading GFortran ${version} from ${downloadUrl}`);
    const downloadPath = await tc.downloadTool(downloadUrl);
    await verifySha256(downloadPath, release.sha256);

    core.info(`Extracting GFortran ${version} from ${downloadPath}...`);
    const extractPath = await tc.extractZip(downloadPath);

    const actualToolDir = path.join(extractPath, "mingw64");

    core.info(`Caching GFortran ${version} in ${actualToolDir}...`);
    toolRoot = await tc.cacheDir(
      actualToolDir,
      `gfortran-verified-${inputs.msystem}`,
      version,
      inputs.arch,
    );
  }

  const binPath = path.join(toolRoot, "bin");
  core.addPath(binPath);

  const gfortranPath = path.join(binPath, "gfortran.exe");
  const gccPath = path.join(binPath, "gcc.exe");
  const gxxPath = path.join(binPath, "g++.exe");

  const resolvedVersion = await resolveInstalledVersion();
  const result = {
    version: resolvedVersion,
    fc: gfortranPath,
    cc: gccPath,
    cxx: gxxPath,
  };
  return result;
}

async function installMSYS2(inputs: Inputs): Promise<InstallationResult> {
  await setupMSYS2(inputs.msystem, ["gcc-fortran"]);

  const msysBin = path.join("C:\\msys64", inputs.msystem, "bin");
  const gfortranPath = path.join(msysBin, "gfortran.exe");
  const gccPath = path.join(msysBin, "gcc.exe");
  const gxxPath = path.join(msysBin, "g++.exe");

  const resolvedVersion = await resolveInstalledVersion();
  const result = {
    version: resolvedVersion,
    fc: gfortranPath,
    cc: gccPath,
    cxx: gxxPath,
  };
  return result;
}

async function resolveInstalledVersion(): Promise<string> {
  let stdout = "";
  const tool = "gfortran";

  try {
    await exec.exec(tool, ["-dumpversion"], {
      silent: true,
      listeners: { stdout: (data) => (stdout += data.toString()) },
    });
  } catch (err) {
    throw new Error(`Failed to verify ${tool} installation`, { cause: err });
  }

  return stdout.trim();
}
