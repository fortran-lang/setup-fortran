import { OS, type InstallationResult, type Inputs } from "../../types";
import { installDebian } from "./debian";
import { installDarwin } from "./darwin";
import { installWin32 } from "./win32";

export async function installFlang(
  inputs: Inputs,
): Promise<InstallationResult> {
  switch (inputs.os) {
    case OS.Linux:
      return await installDebian(inputs);
    case OS.MacOS:
      return await installDarwin(inputs);
    case OS.Windows:
      return await installWin32(inputs);
  }
}
