import { type InstallationResult, OS, type Inputs } from "../../types";
import { installDebian } from "./debian";
import { installWin32 } from "./win32";

export async function installIFX(inputs: Inputs): Promise<InstallationResult> {
  switch (inputs.os) {
    case OS.Linux:
      return await installDebian(inputs);
    case OS.MacOS:
      throw new Error(
        `ifx is not supported on macOS. The previous fortran-lang/setup-fortran ` +
          `action silently treated "compiler: intel" as intel-classic (ifort) on ` +
          `macOS instead of installing ifx. Migrate those matrix entries to ` +
          `"compiler: ifort", or exclude ` +
          `{compiler: ifx, os: macos} from your build matrix.`,
      );
    case OS.Windows:
      return await installWin32(inputs);
  }
}
