import * as core from "@actions/core";
import type { InstallationResult } from "./types";

export function normalizeVersionOutput(output: string): string {
  const trimmed = output.trim();
  if (/^\d+$/.test(trimmed)) {
    return trimmed;
  }

  // AOCC reports its underlying LLVM version before the AOCC release, for
  // example "AMD clang version 17.0.0 (AOCC_5.0.0-Build#...)". Prefer the
  // distribution version users selected over the LLVM implementation detail.
  const aoccMatch = /\bAOCC[_ -]?(\d+(?:\.\d+){1,3})\b/i.exec(trimmed);
  if (aoccMatch?.[1]) {
    return aoccMatch[1];
  }

  const match = /(?:^|[^\d])(\d+(?:\.\d+){1,3})(?![\d.])/.exec(trimmed);
  if (!match?.[1]) {
    throw new Error(`Could not determine compiler version from: ${trimmed}`);
  }
  return match[1];
}

export function exportInstallationVariables(result: InstallationResult): void {
  core.exportVariable("FC", result.fc);
  core.exportVariable("CC", result.cc);
  core.exportVariable("CXX", result.cxx);
  core.exportVariable("FPM_FC", result.fc);
  core.exportVariable("FPM_CC", result.cc);
  core.exportVariable("FPM_CXX", result.cxx);
  core.exportVariable("F77", result.fc);
  core.exportVariable("F90", result.fc);
}

export function setInstallationOutputs(result: InstallationResult): void {
  core.setOutput("version", normalizeVersionOutput(result.version));
  core.setOutput("fc", result.fc);
  core.setOutput("cc", result.cc);
  core.setOutput("cxx", result.cxx);
}
