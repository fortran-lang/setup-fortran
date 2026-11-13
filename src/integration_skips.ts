/**
 * Pure skip predicates for the integration test suite. Kept in a
 * side-effect-free module so they can be unit tested: run_fortran_tests.ts
 * starts its runner at module load.
 */

/**
 * Major of the clang bundled with a native Windows flang toolchain. The
 * installer places the toolchain under
 * `...\flang-verified\<major>.<minor>.<patch>\<arch>\bin\clang++.exe`, and
 * the bundled clang shares that major. MSYS2 and system companions do not
 * match and return undefined.
 */
export function parseBundledClangMajor(
  cxx: string | undefined,
): number | undefined {
  const match = /flang-verified[\\/](\d+)/.exec(cxx ?? "");
  return match ? parseInt(match[1], 10) : undefined;
}

export interface WindowsFlangCxxContext {
  isWindows: boolean;
  isFlang: boolean;
  isMSYS2: boolean;
  bundledClangMajor: number | undefined;
}

/**
 * MSVC STL 14.52 (VS 18) requires Clang 22 or newer to compile its headers
 * (`STL1000: Unexpected compiler version, expected Clang 22 or newer`).
 * flang-verified Windows toolchains bundle a clang of the same major, so
 * older ones cannot build the C++ companion. MSYS2 flang uses the rolling
 * MSYS2 clang instead and is unaffected.
 */
export function windowsFlangCxxSkipReason(
  ctx: WindowsFlangCxxContext,
): string | undefined {
  if (!ctx.isWindows || !ctx.isFlang || ctx.isMSYS2) return undefined;
  const major = ctx.bundledClangMajor;
  if (major === undefined || major >= 22) return undefined;
  return `flang's bundled clang ${major.toString()} cannot compile the MSVC STL headers (Clang 22+ required)`;
}
