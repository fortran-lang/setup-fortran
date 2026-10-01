import * as core from "@actions/core";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

export function toMsysPath(windowsPath: string): string {
  const match = /^([a-z]):[\\/](.*)$/i.exec(windowsPath);
  if (!match) return windowsPath.replace(/\\/g, "/");

  return `/${match[1].toLowerCase()}/${match[2].replace(/\\/g, "/")}`;
}

function quoteForBash(value: string): string {
  return `'${value.replace(/'/g, `'"'"'`)}'`;
}

// `shell: bash` steps run a non-interactive Bash whose PATH puts Git Bash's
// own /usr/bin ahead of every GITHUB_PATH entry, so native executables whose
// names collide with Git utilities (link.exe vs coreutils link is the known
// case) resolve to the wrong binary in any subprocess spawned from Bash.
// Non-interactive Bash sources $BASH_ENV on startup, which is the only hook
// that restores the expected PATH order for those steps.
export function persistBinDirForBash(binDir: string, name: string): string {
  // NOTE: native path.join is intentional here. bashEnv is a real filesystem
  // path under RUNNER_TEMP/os.tmpdir(), so it must use the host OS semantics
  // (the shell-integration test exercises this with a real temp dir on any
  // OS). The BASH_ENV value exported to Bash is normalized via toMsysPath
  // below, which is deterministic across OS. Unit tests must therefore build
  // their expected filesystem paths with path.join, not hardcoded separators.
  const bashEnv = path.join(
    process.env.RUNNER_TEMP ?? os.tmpdir(),
    `setup-fortran-${name}-bash-env.sh`,
  );
  const bashEnvForBash = toMsysPath(bashEnv);
  const previousBashEnv = process.env.BASH_ENV;
  const lines = [
    ...(previousBashEnv && toMsysPath(previousBashEnv) !== bashEnvForBash
      ? [`. ${quoteForBash(toMsysPath(previousBashEnv))}`]
      : []),
    `export PATH=${quoteForBash(toMsysPath(binDir))}:"$PATH"`,
  ];

  fs.writeFileSync(bashEnv, `${lines.join("\n")}\n`, { mode: 0o600 });
  core.exportVariable("BASH_ENV", bashEnvForBash);
  return bashEnv;
}
