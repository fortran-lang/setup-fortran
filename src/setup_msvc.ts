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
