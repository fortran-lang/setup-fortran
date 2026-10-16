import { OS, type InstallationResult, type Inputs } from "../../types";
import { installDebian } from "./debian";

export async function installAOCC(inputs: Inputs): Promise<InstallationResult> {
  if (inputs.os !== OS.Linux) {
    throw new Error(`aocc is only supported on Linux. Got: ${inputs.os}`);
  }
  return await installDebian(inputs);
}
