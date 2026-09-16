export const Compiler = {
  GFortran: "gfortran",
  IFX: "ifx",
  IFort: "ifort",
  NVFortran: "nvfortran",
  AOCC: "aocc",
  Flang: "flang",
  LFortran: "lfortran",
  ArmFlang: "armflang",
} as const;
export type Compiler = (typeof Compiler)[keyof typeof Compiler];

export const OS = {
  Linux: "linux",
  MacOS: "darwin",
  Windows: "win32",
} as const;
export type OS = (typeof OS)[keyof typeof OS];

export const Arch = {
  X64: "x64",
  ARM64: "arm64",
} as const;
export type Arch = (typeof Arch)[keyof typeof Arch];

export const Msystem = {
  Native: "native",
  UCRT64: "ucrt64",
  Clang64: "clang64",
} as const;
export type Msystem = (typeof Msystem)[keyof typeof Msystem];

export interface Inputs {
  compiler: Compiler;
  version: string;
  os: OS;
  osVersion: string;
  arch: Arch;
  msystem: Msystem;
  cleanupDisk: boolean;
  updateEnvironment: boolean;
}

export const LATEST = "latest" as const;
export type Latest = typeof LATEST;

export interface InstallationResult {
  version: string;
  fc: string;
  cc: string;
  cxx: string;
}
