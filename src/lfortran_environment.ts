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
  const windows = inputs.os === OS.Windows;
  const p = windows ? path.win32 : path.posix;
  const toolRoot =
    process.env.RUNNER_TOOL_CACHE ??
    path.join(os.tmpdir(), "setup-fortran-tool-cache");
  const root = p.join(
    toolRoot,
    "setup-fortran",
    "lfortran",
    inputs.os,
    inputs.arch,
    version,
  );
  const miniforgePrefix = p.join(root, "miniforge");
  const envPrefix = p.join(root, "env");
  const binDir = windows
    ? p.join(envPrefix, "Library", "bin")
    : p.join(envPrefix, "bin");
  return {
    root,
    miniforgePrefix,
    conda: windows
      ? p.join(miniforgePrefix, "Scripts", "conda.exe")
      : p.join(miniforgePrefix, "bin", "conda"),
    envPrefix,
    binDir,
    lfortran: p.join(binDir, windows ? "lfortran.exe" : "lfortran"),
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
    core.info(
      `Could not validate existing LFortran ${version} environment: ${String(error)}`,
    );
    return false;
  }
}

export function resetLFortranEnvironment(
  environment: LFortranEnvironment,
): void {
  if (fs.existsSync(environment.root)) {
    core.info(
      `Removing stale or incomplete LFortran environment at ${environment.root}.`,
    );
    fs.rmSync(environment.root, { recursive: true, force: true });
  }
  fs.mkdirSync(path.dirname(environment.root), { recursive: true });
}

// Make network operations more tolerant of slow/unstable runner networks.
// The Miniforge installer bootstraps with micromamba, which only reads
// MAMBA_* variables; the conda binary it installs reads CONDA_* variables
// for the subsequent `conda create`. The default connect/resolve timeout is
// too short on some GitHub-hosted runners (especially macOS), causing
// intermittent "Resolving timed out after 30000 milliseconds" failures.
// Mutating process.env (instead of passing an explicit env to exec) keeps
// the exec call signatures unchanged for callers/tests.
export function applyMiniforgeTimeoutEnv(): void {
  process.env.MAMBA_REMOTE_CONNECT_TIMEOUT_SECS ??= "120";
  process.env.MAMBA_REMOTE_MAX_RETRIES ??= "5";
  process.env.MAMBA_REMOTE_BACKOFF_FACTOR ??= "2";
  process.env.MAMBA_NO_LOW_SPEED_LIMIT ??= "1";

  process.env.CONDA_REMOTE_CONNECT_TIMEOUT_SECS ??= "120";
  process.env.CONDA_REMOTE_READ_TIMEOUT_SECS ??= "300";
  process.env.CONDA_REMOTE_MAX_RETRIES ??= "5";
  process.env.CONDA_REMOTE_BACKOFF_FACTOR ??= "2";
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
    core.info(
      `conda create failed (attempt ${attempt.toString()}/${maxAttempts.toString()}), retrying in ${delaySeconds.toString()}s...`,
    );

    await new Promise((resolve) => setTimeout(resolve, delaySeconds * 1000));
  }
}
