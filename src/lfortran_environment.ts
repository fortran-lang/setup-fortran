import * as core from "@actions/core";
import * as exec from "@actions/exec";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { OS, type Inputs } from "./types";

export interface LFortranEnvironment {
  root: string;
  miniforgePrefix: string;
  conda: string;
  envPrefix: string;
  binDir: string;
  lfortran: string;
}

export function lfortranEnvironment(
  inputs: Inputs,
  version: string,
): LFortranEnvironment {
  const toolRoot =
    process.env.RUNNER_TOOL_CACHE ??
    path.join(os.tmpdir(), "setup-fortran-tool-cache");
  const root = path.join(
    toolRoot,
    "setup-fortran",
    "lfortran",
    inputs.os,
    inputs.arch,
    version,
  );
  const miniforgePrefix = path.join(root, "miniforge");
  const envPrefix = path.join(root, "env");
  const windows = inputs.os === OS.Windows;
  const binDir = windows
    ? path.join(envPrefix, "Library", "bin")
    : path.join(envPrefix, "bin");
  return {
    root,
    miniforgePrefix,
    conda: windows
      ? path.join(miniforgePrefix, "Scripts", "conda.exe")
      : path.join(miniforgePrefix, "bin", "conda"),
    envPrefix,
    binDir,
    lfortran: path.join(binDir, windows ? "lfortran.exe" : "lfortran"),
  };
}

export async function isReusableLFortranEnvironment(
  environment: LFortranEnvironment,
  version: string,
): Promise<boolean> {
  if (
    !fs.existsSync(environment.conda) ||
    !fs.existsSync(environment.lfortran)
  ) {
    return false;
  }

  let output = "";
  try {
    const exitCode = await exec.exec(
      environment.conda,
      ["run", "-p", environment.envPrefix, "lfortran", "--version"],
      {
        ignoreReturnCode: true,
        silent: true,
        listeners: {
          stdout: (data: Buffer) => {
            output += data.toString();
          },
        },
      },
    );
    return exitCode === 0 && output.includes(version);
  } catch (error) {
    core.warning(
      `Could not validate existing LFortran ${version} environment: ${String(error)}`,
    );
    return false;
  }
}

export function resetLFortranEnvironment(
  environment: LFortranEnvironment,
): void {
  if (fs.existsSync(environment.root)) {
    core.warning(
      `Removing stale or incomplete LFortran environment at ${environment.root}.`,
    );
    fs.rmSync(environment.root, { recursive: true, force: true });
  }
  fs.mkdirSync(path.dirname(environment.root), { recursive: true });
}

export function createInstallerTempDir(): string {
  const runnerTemp = process.env.RUNNER_TEMP ?? os.tmpdir();
  fs.mkdirSync(runnerTemp, { recursive: true });
  return fs.mkdtempSync(path.join(runnerTemp, "setup-fortran-lfortran-"));
}

// `conda create` fetches channel repodata and downloads packages over the
// network, both of which can fail transiently (read timeouts, 5xx, rate
// limits). Retrying the whole command is safe: conda reuses its package cache,
// so a retry only re-fetches what actually failed.
export async function condaCreateWithRetry(
  condaBin: string,
  args: string[],
  maxAttempts = 3,
): Promise<void> {
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const exitCode = await exec.exec(condaBin, args, {
      ignoreReturnCode: true,
    });

    if (exitCode === 0) return;

    if (attempt === maxAttempts) {
      throw new Error(
        `conda create failed after ${maxAttempts.toString()} attempts.`,
      );
    }

    const delaySeconds = attempt * 15;
    core.warning(
      `conda create failed (attempt ${attempt.toString()}/${maxAttempts.toString()}), retrying in ${delaySeconds.toString()}s...`,
    );

    await new Promise((resolve) => setTimeout(resolve, delaySeconds * 1000));
  }
}
