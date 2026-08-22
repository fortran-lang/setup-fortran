import { OS, type InstallationResult, type Inputs } from "../../types";
import { installDebian } from "./debian";

export async function installArmFlang(
  inputs: Inputs,
): Promise<InstallationResult> {
  if (inputs.os !== OS.Linux) {
    throw new Error(`armflang is only supported on Linux. Got: ${inputs.os}`);
  }
  return await installDebian(inputs);
}
