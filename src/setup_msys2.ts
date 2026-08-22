import * as core from "@actions/core";
import * as exec from "@actions/exec";
import * as path from "path";
import { Msystem } from "./types";

const MSYS2_ROOT = "C:\\msys64";

const PKG_PREFIX: Record<Msystem, string | undefined> = {
  [Msystem.UCRT64]: "mingw-w64-ucrt-x86_64",
  [Msystem.Clang64]: "mingw-w64-clang-x86_64",
  [Msystem.Native]: undefined,
};

export async function setupMSYS2(
  msystem: Msystem,
  packages: string[],
): Promise<void> {
  if (packages.length === 0) return;

  const pkgList = packages.map((pkg) => msys2PkgName(msystem, pkg)).join(" ");
  core.info(`Installing MSYS2 packages (${msystem}): ${pkgList}`);

  await pacmanInstallWithRetry(pkgList);

  const msysRoot = path.join(MSYS2_ROOT, msystem);
  const msysBin = path.join(msysRoot, "bin");
  const msysLib = path.join(msysRoot, "lib");

  core.addPath(msysBin);
  core.exportVariable("MSYSTEM", msystem.toUpperCase());
  core.exportVariable("MSYS2_PATH_TYPE", "inherit");
  core.exportVariable("PKG_CONFIG_PATH", path.join(msysLib, "pkgconfig"));
}

// pacman's default mirror list occasionally hands out a slow/dead mirror
// (e.g. ftp2.osuosl.org stalling mid-download), which aborts the whole
// transaction. --needed makes retries safe: already-downloaded packages
// are skipped, so a retry only has to fetch what actually failed.
export async function pacmanInstallWithRetry(
  pkgList: string,
  maxAttempts = 3,
): Promise<void> {
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      await exec.exec("C:\\msys64\\usr\\bin\\bash.exe", [
        "-lc",
        `pacman -S --noconfirm --needed ${pkgList}`,
      ]);
      return;
    } catch (err) {
      if (attempt === maxAttempts) throw err;
      core.warning(
        `pacman install failed (attempt ${String(attempt)}/${String(maxAttempts)}), retrying in ${String(attempt * 15)}s...`,
      );
      await new Promise((res) => setTimeout(res, attempt * 15_000));
    }
  }
}

export function msys2PkgName(msystem: Msystem, pkg: string): string {
  const prefix = PKG_PREFIX[msystem];
  if (!prefix) {
    throw new Error(
      `No MSYS2 package prefix known for environment: ${msystem}`,
    );
  }
  return `${prefix}-${pkg}`;
}
