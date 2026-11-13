import * as core from "@actions/core";
import { persistBinDirForBash, toMsysPath } from "./bash_env";

export { toMsysPath };

export function persistMsvcBinForBash(msvcBin: string): string {
  return persistBinDirForBash(msvcBin, "msvc");
}

export function addMsvcBinFromPath(pathValue: string): string | undefined {
  const msvcBin = pathValue.split(";").find((entry) => {
    const normalized = entry.toLowerCase();
    return (
      normalized.includes("\\vc\\tools\\msvc\\") &&
      normalized.includes("\\bin\\host")
    );
  });

  if (msvcBin) {
    core.addPath(msvcBin);
    persistMsvcBinForBash(msvcBin);
  } else {
    core.warning("Could not find the MSVC executable directory in PATH.");
  }

  return msvcBin;
}

// core.exportVariable("PATH") only sets the baseline; earlier core.addPath
// entries (e.g. gfortran) are re-prepended over it, so addPath this one too.
export function addIntelCompilerBinFromPath(
  pathValue: string,
): string | undefined {
  const intelBin = pathValue.split(";").find((entry) => {
    const normalized = entry.toLowerCase();
    return (
      normalized.includes("\\oneapi\\compiler\\") &&
      normalized.endsWith("\\bin")
    );
  });

  if (intelBin) {
    core.addPath(intelBin);
  } else {
    core.warning(
      "Could not find the Intel compiler executable directory in PATH.",
    );
  }

  return intelBin;
}
