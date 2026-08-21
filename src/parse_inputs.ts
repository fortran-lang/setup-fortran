import * as core from "@actions/core";
import * as os from "os";
import { Compiler, OS, Arch, Msystem, LATEST, type Inputs } from "./types";

const DEFAULTS = {
  compiler: Compiler.GFortran,
  version: LATEST,
  msystem: Msystem.Native,
  cleanupDisk: false,
  updateEnvironment: true,
} as const;

const COMPILER_ALIASES: Readonly<Record<string, Compiler>> = {
  gcc: Compiler.GFortran,
  intel: Compiler.IFX,
  "intel-classic": Compiler.IFort,
  "nvidia-hpc": Compiler.NVFortran,
};

function detectOS(): OS {
  switch (process.platform) {
    case "linux":
      return OS.Linux;
    case "darwin":
      return OS.MacOS;
    case "win32":
      return OS.Windows;
    case "aix": {
      throw new Error('Not implemented yet: "aix" case');
    }
    case "android": {
      throw new Error('Not implemented yet: "android" case');
    }
    case "freebsd": {
      throw new Error('Not implemented yet: "freebsd" case');
    }
    case "haiku": {
      throw new Error('Not implemented yet: "haiku" case');
    }
    case "openbsd": {
      throw new Error('Not implemented yet: "openbsd" case');
    }
    case "sunos": {
      throw new Error('Not implemented yet: "sunos" case');
    }
    case "cygwin": {
      throw new Error('Not implemented yet: "cygwin" case');
    }
    case "netbsd": {
      throw new Error('Not implemented yet: "netbsd" case');
    }
  }
}

function detectArch(): Arch {
  switch (os.arch()) {
    case "x64":
      return Arch.X64;
    case "arm64":
      return Arch.ARM64;
    case "arm": {
      throw new Error('Not implemented yet: "arm" case');
    }
    case "ia32": {
      throw new Error('Not implemented yet: "ia32" case');
    }
    case "loong64": {
      throw new Error('Not implemented yet: "loong64" case');
    }
    case "mips": {
      throw new Error('Not implemented yet: "mips" case');
    }
    case "mipsel": {
      throw new Error('Not implemented yet: "mipsel" case');
    }
    case "ppc64": {
      throw new Error('Not implemented yet: "ppc64" case');
    }
    case "riscv64": {
      throw new Error('Not implemented yet: "riscv64" case');
    }
    case "s390x": {
      throw new Error('Not implemented yet: "s390x" case');
    }
  }
}

function parseCompiler(raw: string): Compiler {
  const canonicalCompilers = Object.values(Compiler);
  const val = raw.toLowerCase().trim();
  const compiler = COMPILER_ALIASES[val] ?? (val as Compiler);
  if (canonicalCompilers.includes(compiler)) {
    if (val in COMPILER_ALIASES) {
      core.warning(
        `The compiler selector "${val}" is deprecated; please use "${compiler}" instead.`,
      );
    }
    return compiler;
  }

  const valid = [...canonicalCompilers, ...Object.keys(COMPILER_ALIASES)];
  throw new Error(
    `Unknown compiler "${raw}". Valid options: ${valid.join(", ")}`,
  );
}

function parseMsystem(raw: string): Msystem {
  const valid = Object.values(Msystem);
  const val = raw.toLowerCase().trim() as Msystem;
  if (valid.includes(val)) return val;
  throw new Error(
    `Unknown msystem "${raw}". Valid options: ${valid.join(", ")}`,
  );
}

export function parseInputs(): Inputs {
  const rawCompiler = core.getInput("compiler").trim() || DEFAULTS.compiler;
  const rawVersion = core.getInput("version").trim() || DEFAULTS.version;
  const rawMsystem = core.getInput("msystem").trim();
  const cleanupDisk = core.getBooleanInput("cleanup-disk");
  const updateEnvironment = core.getBooleanInput("update-environment");

  const compiler = parseCompiler(rawCompiler);
  const detectedOS = detectOS();

  const inputs: Inputs = {
    compiler,
    version: rawVersion,
    os: detectedOS,
    osVersion: process.env.ImageOS ?? os.release(),
    arch: detectArch(),
    msystem: rawMsystem ? parseMsystem(rawMsystem) : DEFAULTS.msystem,
    cleanupDisk,
    updateEnvironment,
  };

  return inputs;
}
