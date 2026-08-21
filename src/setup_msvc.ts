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

export function persistMsvcBinForBash(msvcBin: string): string {
  const bashEnv = path.join(
    process.env.RUNNER_TEMP ?? os.tmpdir(),
    "setup-fortran-msvc-bash-env.sh",
  );
  const bashEnvForBash = toMsysPath(bashEnv);
  const previousBashEnv = process.env.BASH_ENV;
  const lines = [
    ...(previousBashEnv && toMsysPath(previousBashEnv) !== bashEnvForBash
      ? [`. ${quoteForBash(toMsysPath(previousBashEnv))}`]
      : []),
    `export PATH=${quoteForBash(toMsysPath(msvcBin))}:"$PATH"`,
  ];

  fs.writeFileSync(bashEnv, `${lines.join("\n")}\n`, { mode: 0o600 });
  core.exportVariable("BASH_ENV", bashEnvForBash);
  return bashEnv;
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
