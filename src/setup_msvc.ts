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

// Intel's setvars.bat composes a full PATH with the compiler's own bin
// directory already ahead of everything else, but exporting that composed
// string via core.exportVariable("PATH", ...) only sets the baseline PATH
// for later steps. GITHUB_PATH entries added via core.addPath (e.g.
// gfortran's) are re-prepended on top of that baseline for the rest of the
// job regardless, so a prior addPath call would otherwise keep winning over
// a later Intel installation. Registering the compiler's own bin directory
// through addPath too lets it compete on equal footing.
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
