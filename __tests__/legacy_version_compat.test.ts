import { resolveVersion, resolveWindowsVersion } from "../src/resolve_version";
import { Arch, Compiler, LATEST, OS, Msystem, type Inputs } from "../src/types";

jest.mock("@actions/core");

// ===========================================================================
// Incumbent parity guard.
//
// Every green cell that fortran-lang/setup-fortran verified in its generated
// compatibility matrix (`setup-fortran/.github/compat/compat.csv`) must still
// be accepted by the replacement's resolvers after the selector is migrated to
// the canonical compiler name. The version tables below intentionally mirror
// the installed SUPPORTED_VERSIONS arrays in src/installers/*; they are kept
// in this dedicated test so dropping a legacy spelling produces a visible test
// failure instead of a quiet behaviour change.
//
// Two incumbent cells are deliberate, documented deviations and live in
// `UNSUPPORTED_INCUMBENT_CELLS` instead of the acceptance table:
//   - `ifort` on macOS ARM64 runners (macos-14/15/26): the replacement removed
//     the Rosetta-based ifort support ([Arch.ARM64] is undefined).
//   - `ifx` (compiler: intel) on macOS: the replacement intentionally fails
//     instead of silently redirecting to intel-classic/ifort.
// ===========================================================================

type Os = "linux" | "macos" | "windows";
type ArchLabel = "x64" | "arm64";
type CompatCell = readonly [string, string, Os, ArchLabel];

// Generated from setup-fortran/.github/compat/compat.csv green cells
// (modern runners: ubuntu-22.04/24.04, macos-14/15/15-intel/26/26-intel,
// windows-2022/2025/2025-vs2026) with selectors mapped to canonical names.
const INCUMBENT_GREEN_CELLS: readonly CompatCell[] = [
  // AOCC 5.1.0 (X.Y.0 spelling is normalized to the 5.1 entry).
  ["aocc", "5.1.0", "linux", "x64"],
  // GCC 13/14/15 on every runner (gcc -> gfortran).
  ["gfortran", "13", "linux", "x64"],
  ["gfortran", "13", "macos", "arm64"],
  ["gfortran", "13", "macos", "x64"],
  ["gfortran", "13", "windows", "x64"],
  ["gfortran", "14", "linux", "x64"],
  ["gfortran", "14", "macos", "arm64"],
  ["gfortran", "14", "macos", "x64"],
  ["gfortran", "14", "windows", "x64"],
  ["gfortran", "15", "linux", "x64"],
  ["gfortran", "15", "macos", "arm64"],
  ["gfortran", "15", "macos", "x64"],
  ["gfortran", "15", "windows", "x64"],
  // ifort (intel-classic) on Linux, Intel macOS, and Windows.
  ["ifort", "2021.1", "linux", "x64"],
  ["ifort", "2021.1", "macos", "x64"],
  ["ifort", "2021.1.2", "linux", "x64"],
  ["ifort", "2021.10", "linux", "x64"],
  ["ifort", "2021.10", "macos", "x64"],
  ["ifort", "2021.10", "windows", "x64"],
  ["ifort", "2021.11", "linux", "x64"],
  ["ifort", "2021.11", "windows", "x64"],
  ["ifort", "2021.12", "linux", "x64"],
  ["ifort", "2021.12", "windows", "x64"],
  ["ifort", "2021.2", "linux", "x64"],
  ["ifort", "2021.2", "macos", "x64"],
  ["ifort", "2021.3", "macos", "x64"],
  ["ifort", "2021.4", "linux", "x64"],
  ["ifort", "2021.5", "linux", "x64"],
  ["ifort", "2021.5", "macos", "x64"],
  ["ifort", "2021.6", "linux", "x64"],
  ["ifort", "2021.6", "macos", "x64"],
  ["ifort", "2021.6", "windows", "x64"],
  ["ifort", "2021.7.1", "linux", "x64"],
  ["ifort", "2021.8", "linux", "x64"],
  ["ifort", "2021.8", "macos", "x64"],
  ["ifort", "2021.9", "linux", "x64"],
  ["ifort", "2021.9", "macos", "x64"],
  ["ifort", "2021.9", "windows", "x64"],
  // ifx (intel) on Linux — all 18 incumbent spellings.
  ["ifx", "2021.1", "linux", "x64"],
  ["ifx", "2021.1.2", "linux", "x64"],
  ["ifx", "2021.2", "linux", "x64"],
  ["ifx", "2021.4", "linux", "x64"],
  ["ifx", "2022.0", "linux", "x64"],
  ["ifx", "2022.1", "linux", "x64"],
  ["ifx", "2022.2", "linux", "x64"],
  ["ifx", "2022.2.1", "linux", "x64"],
  ["ifx", "2023.0", "linux", "x64"],
  ["ifx", "2023.1", "linux", "x64"],
  ["ifx", "2023.2", "linux", "x64"],
  ["ifx", "2024.0", "linux", "x64"],
  ["ifx", "2024.1", "linux", "x64"],
  ["ifx", "2025.0", "linux", "x64"],
  ["ifx", "2025.2", "linux", "x64"],
  ["ifx", "2025.3", "linux", "x64"],
  ["ifx", "2026.0", "linux", "x64"],
  ["ifx", "2026.1", "linux", "x64"],
  // ifx (intel) on Windows — incumbent-verified set plus code-level 2023.0.
  // ["ifx", "2022.1", "windows", "x64"],
  ["ifx", "2022.2", "windows", "x64"],
  ["ifx", "2023.0", "windows", "x64"],
  ["ifx", "2023.1", "windows", "x64"],
  ["ifx", "2023.2", "windows", "x64"],
  ["ifx", "2024.0", "windows", "x64"],
  ["ifx", "2024.1", "windows", "x64"],
  ["ifx", "2025.0", "windows", "x64"],
  ["ifx", "2025.2", "windows", "x64"],
  ["ifx", "2025.3", "windows", "x64"],
  ["ifx", "2026.0", "windows", "x64"],
  ["ifx", "2026.1", "windows", "x64"],
  // LFortran 0.57.0 / 0.58.0 on every runner.
  ["lfortran", "0.57.0", "linux", "x64"],
  ["lfortran", "0.57.0", "macos", "arm64"],
  ["lfortran", "0.57.0", "macos", "x64"],
  ["lfortran", "0.57.0", "windows", "x64"],
  ["lfortran", "0.58.0", "linux", "x64"],
  ["lfortran", "0.58.0", "macos", "arm64"],
  ["lfortran", "0.58.0", "macos", "x64"],
  ["lfortran", "0.58.0", "windows", "x64"],
  // nvidia-hpc (nvfortran) on Ubuntu.
  ["nvfortran", "23.11", "linux", "x64"],
  ["nvfortran", "23.3", "linux", "x64"],
  ["nvfortran", "23.5", "linux", "x64"],
  ["nvfortran", "23.7", "linux", "x64"],
  ["nvfortran", "23.9", "linux", "x64"],
  ["nvfortran", "24.1", "linux", "x64"],
  ["nvfortran", "24.3", "linux", "x64"],
  ["nvfortran", "24.5", "linux", "x64"],
  ["nvfortran", "25.1", "linux", "x64"],
  ["nvfortran", "25.3", "linux", "x64"],
  ["nvfortran", "25.5", "linux", "x64"],
  ["nvfortran", "25.7", "linux", "x64"],
  ["nvfortran", "25.9", "linux", "x64"],
  ["nvfortran", "26.1", "linux", "x64"],
];

const UNSUPPORTED_INCUMBENT_CELLS: readonly CompatCell[] = [
  // ifort (intel-classic) was verified on ARM macOS under Rosetta by the
  // incumbent; the replacement deliberately marks ARM64 unsupported.
  ["ifort", "2021.1", "macos", "arm64"],
  ["ifort", "2021.10", "macos", "arm64"],
  ["ifort", "2021.2", "macos", "arm64"],
  ["ifort", "2021.3", "macos", "arm64"],
  ["ifort", "2021.5", "macos", "arm64"],
  ["ifort", "2021.6", "macos", "arm64"],
  ["ifort", "2021.8", "macos", "arm64"],
  ["ifort", "2021.9", "macos", "arm64"],
];

// ---------------------------------------------------------------------------
// Installer-mirroring supported tables (native msystem). Keep in sync with
// the SUPPORTED_VERSIONS arrays in src/installers/*.
// ---------------------------------------------------------------------------

const GF = ["16", "15", "14", "13", "12", "11"] as const;

const IFX_LINUX = [
  "2026.1",
  "2026.0",
  "2025.3",
  "2025.2",
  "2025.1",
  "2025.0",
  "2024.2",
  "2024.1",
  "2024.0",
  "2023.2.4",
  "2023.2.3",
  "2023.2.2",
  "2023.2.1",
  "2023.2.0",
  "2023.1.0",
  "2023.0.0",
  "2022.2.1",
  "2022.2.0",
  "2022.1.0",
  "2022.0.2",
  "2022.0.1",
  "2021.4.0",
  "2021.3.0",
  "2021.2.0",
  "2021.1.2",
  "2021.1.1",
] as const;

const IFX_WINDOWS = [
  "2026.1.1",
  "2026.1.0",
  "2026.0.0",
  "2025.3.3",
  "2025.3.2",
  "2025.3.1",
  "2025.3.0",
  "2025.2.1",
  "2025.2.0",
  "2025.1.0",
  "2025.0.4",
  "2025.0.3",
  "2025.0.1",
  "2025.0.0",
  "2024.2.1",
  "2024.2.0",
  "2024.1.0",
  "2024.0.2",
  "2024.0.1",
  "2023.2.1",
  "2023.2.0",
  "2023.1.0",
  "2023.0.0",
  "2022.3.0",
  "2022.2.0",
] as const;

const IFORT_LINUX = [
  "2021.13",
  "2021.12",
  "2021.11",
  "2021.10",
  "2021.9",
  "2021.8",
  "2021.7.1",
  "2021.7",
  "2021.6",
  "2021.5",
  "2021.4",
  "2021.3",
  "2021.2",
  "2021.1.2",
  "2021.1",
] as const;

const IFORT_MACOS = [
  "2021.10",
  "2021.9",
  "2021.8",
  "2021.6",
  "2021.5",
  "2021.3",
  "2021.2",
  "2021.1",
] as const;

const IFORT_WINDOWS = [
  "2021.13",
  "2021.12",
  "2021.11",
  "2021.10",
  "2021.9",
  "2021.8",
  "2021.7",
  "2021.6",
] as const;

const NVF = [
  "26.5",
  "26.3",
  "26.1",
  "25.11",
  "25.9",
  "25.7",
  "25.5",
  "25.3",
  "25.1",
  "24.11",
  "24.9",
  "24.7",
  "24.5",
  "24.3",
  "24.1",
  "23.11",
  "23.9",
  "23.7",
  "23.5",
  "23.3",
  "23.1",
  "22.11",
  "22.9",
  "22.7",
  "22.5",
  "22.3",
  "22.2",
  "22.1",
  "21.11",
  "21.9",
  "21.7",
  "21.5",
  "21.3",
  "21.2",
  "21.1",
  "20.11",
  "20.9",
  "20.7",
] as const;

const LF = [
  "0.64.0",
  "0.63.0",
  "0.62.0",
  "0.61.0",
  "0.60.0",
  "0.59.0",
  "0.58.0",
  "0.57.0",
] as const;

const AOCC = ["5.2", "5.1", "5.0", "4.2", "4.1"] as const;

function buildInputs(
  compiler: string,
  version: string,
  os: string,
  arch: string,
): Inputs {
  const platform =
    os === "windows" ? OS.Windows : os === "macos" ? OS.MacOS : OS.Linux;
  return {
    compiler: compiler as Compiler,
    version,
    os: platform,
    osVersion: "22.04",
    arch: arch === "arm64" ? Arch.ARM64 : Arch.X64,
    cleanupDisk: false,
    updateEnvironment: true,
    msystem: Msystem.Native,
  };
}

function winTable(
  versions: readonly string[],
): Record<Arch, Record<Msystem, readonly string[] | undefined> | undefined> {
  return {
    [Arch.X64]: {
      [Msystem.Native]: versions,
      [Msystem.UCRT64]: [LATEST],
      [Msystem.Clang64]: [LATEST],
    },
    [Arch.ARM64]: undefined,
  };
}

function archTable(
  versions: readonly string[],
): Record<Arch, readonly string[] | undefined> {
  return { [Arch.X64]: versions, [Arch.ARM64]: undefined };
}

// Both architectures are supported for these compilers on the recorded OSes.
function bothArchTable(
  versions: readonly string[],
): Record<Arch, readonly string[] | undefined> {
  return { [Arch.X64]: versions, [Arch.ARM64]: versions };
}

function resolve(cell: CompatCell): string {
  const [compiler, version, os, arch] = cell;
  const inputs = buildInputs(compiler, version, os, arch);

  switch (compiler) {
    case "gfortran":
      return resolveVersion(inputs, bothArchTable(GF));
    case "ifx":
      if (os === "windows") {
        return resolveWindowsVersion(inputs, winTable(IFX_WINDOWS), {
          resolveMinorToLatestPatch: true,
        });
      }
      return resolveVersion(inputs, archTable(IFX_LINUX), {
        resolveMinorToLatestPatch: true,
      });
    case "ifort":
      if (os === "windows") {
        return resolveWindowsVersion(inputs, winTable(IFORT_WINDOWS));
      }
      return resolveVersion(
        inputs,
        archTable(os === "macos" ? IFORT_MACOS : IFORT_LINUX),
      );
    case "nvfortran":
      return resolveVersion(inputs, archTable(NVF));
    case "lfortran":
      return resolveVersion(inputs, bothArchTable(LF));
    case "aocc":
      return resolveVersion(inputs, archTable(AOCC), {
        stripPatchZero: true,
      });
    default:
      throw new Error(`Unknown compiler in test fixture: ${compiler}`);
  }
}

describe("incumbent compat.csv parity", () => {
  it.each(INCUMBENT_GREEN_CELLS)(
    "accepts %s %s on %s/%s",
    (compiler, version, os, arch) => {
      expect(() => resolve([compiler, version, os, arch])).not.toThrow();
    },
  );

  it.each(UNSUPPORTED_INCUMBENT_CELLS)(
    "deliberately rejects %s %s on %s/%s",
    (compiler, version, os, arch) => {
      expect(() => resolve([compiler, version, os, arch])).toThrow(
        /not supported|No supported versions|is not supported/,
      );
    },
  );
});
