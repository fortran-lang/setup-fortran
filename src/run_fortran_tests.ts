import * as exec from "@actions/exec";
import * as core from "@actions/core";
import * as path from "path";
import * as fs from "fs";
import { Compiler, LATEST, OS, Msystem, type Latest } from "./types";
import { MSYS2_ROOT } from "./setup_msys2";

interface CompilerFlags {
  module: string[];
  openmp: string[];
  linkerFlags: string[];
}

function getCompilerFlags(
  compiler: Compiler,
  isWindows: boolean,
): CompilerFlags {
  const lFortranLinker = process.env.LFORTRAN_LINKER;

  switch (compiler) {
    case Compiler.IFX:
    case Compiler.IFort:
      return {
        module: isWindows ? ["-module:test_build"] : ["-module", "test_build"],
        openmp: [isWindows ? "-Qopenmp" : "-qopenmp"],
        linkerFlags: [],
      };
    case Compiler.NVFortran:
      return {
        module: ["-module", "test_build"],
        openmp: ["-mp"],
        linkerFlags: [],
      };
    case Compiler.LFortran:
      return {
        module: ["-J", "test_build"],
        openmp: [
          "--openmp",
          `--openmp-lib-dir=${process.env.LFORTRAN_OMP_LIB_DIR ?? ""}`,
        ],
        linkerFlags:
          isWindows && lFortranLinker ? [`--linker=${lFortranLinker}`] : [],
      };
    case Compiler.GFortran:
    case Compiler.AOCC:
    case Compiler.Flang:
    case Compiler.ArmFlang:
      return {
        module: ["-J", "test_build"],
        openmp: ["-fopenmp"],
        linkerFlags: [],
      };
    default:
      throw new Error(`Unsupported compiler: ${compiler as string}`);
  }
}

// Returns extra flags needed to compile a file that uses the C preprocessor.
// Capital-F extensions (.F90) imply preprocessing for gfortran/flang, but
// lfortran requires an explicit flag; Intel on Windows uses -fpp instead of -cpp.
function getCppFlags(compiler: Compiler, isWindows: boolean): string[] {
  if (compiler === Compiler.LFortran) return ["--cpp"];
  if ((compiler === Compiler.IFX || compiler === Compiler.IFort) && isWindows)
    return ["-fpp"];
  return [];
}

// Major version suffix of the companion C++ compiler basename ("g++-11" -> 11,
// "g++" -> unknown). Unknown versions never cause a skip.
function companionMajor(cxxEnv: string | undefined): number {
  const match = /(\d+)$/.exec(path.basename(cxxEnv ?? ""));
  return match ? parseInt(match[1], 10) : Number.POSITIVE_INFINITY;
}

// Parses the glibc version from `ldd --version` (e.g. "2.39"); returns
// undefined on non-glibc systems or when the output is unparseable.
async function detectGlibcVersion(): Promise<number | undefined> {
  let output = "";
  const code = await exec.exec("ldd", ["--version"], {
    ignoreReturnCode: true,
    silent: true,
    listeners: {
      stdout: (data: Buffer) => {
        output += data.toString();
      },
      stderr: (data: Buffer) => {
        output += data.toString();
      },
    },
  });
  if (code !== 0) return undefined;
  const match = /(\d+\.\d+)/.exec(output);
  return match ? parseFloat(match[1]) : undefined;
}

// Major.minor version of the nvc++ companion (e.g. "23.9"), parsed from
// `nvc++ --version`; undefined when the probe fails. The nvfortran
// installer exports only the bare "nvc++" name, so the version cannot be
// derived from the environment and has to be queried from the compiler.
// NVIDIA releases are calendar-based ("21.11"), so the version is kept as
// a major/minor pair rather than a float, where 21.9 would compare above
// 21.11.
interface NvcxxVersion {
  major: number;
  minor: number;
}

async function detectNvcxxVersion(): Promise<NvcxxVersion | undefined> {
  let output = "";
  const code = await exec.exec("nvc++", ["--version"], {
    ignoreReturnCode: true,
    silent: true,
    listeners: {
      stdout: (data: Buffer) => {
        output += data.toString();
      },
      stderr: (data: Buffer) => {
        output += data.toString();
      },
    },
  });
  if (code !== 0) return undefined;
  const match = /nvc\+\+\s+(\d{2})\.(\d{1,2})/.exec(output);
  if (!match) return undefined;
  return { major: parseInt(match[1], 10), minor: parseInt(match[2], 10) };
}

// True when the nvc++ version is older than the given major.minor release.
function isOlderThan(
  version: NvcxxVersion,
  major: number,
  minor: number,
): boolean {
  return (
    version.major < major || (version.major === major && version.minor < minor)
  );
}

// Link flags for the Fortran driver when linking C++ objects: the C++ standard
// library must be pulled in explicitly, and the correct one depends on the
// companion C++ compiler (GNU g++ links libstdc++, clang++ companions link
// libc++ on macOS, Intel and NVIDIA have dedicated options). Returns a skip
// reason for combinations that are not exercised yet.
function getCxxLinkFlags(
  compiler: Compiler,
  platform: OS,
  isMSYS2: boolean,
  glibcVersion?: number,
  nvcxxVersion?: NvcxxVersion,
): { flags: string[]; skip?: string } {
  if (
    compiler === Compiler.GFortran &&
    platform === OS.MacOS &&
    companionMajor(process.env.CXX) < 13
  ) {
    return {
      flags: [],
      skip: `the ${path.basename(process.env.CXX ?? "")} companion cannot parse current macOS SDK headers`,
    };
  }
  switch (compiler) {
    case Compiler.GFortran:
    case Compiler.AOCC:
    case Compiler.ArmFlang:
      // GNU g++-style companions (brew g++ on macOS, g++ on Linux).
      return { flags: ["-lstdc++"] };
    case Compiler.Flang:
      if (platform === OS.Windows) {
        // MSVC-ABI objects (LLVM native installers) carry /DEFAULTLIB
        // directives for the CRT and the C++ runtime, which lld-link resolves
        // through the LIB paths the installer exports. mingw objects (MSYS2)
        // carry no such directives, so libstdc++ must be linked explicitly
        // after the objects (GNU ld defaults to --as-needed).
        return { flags: isMSYS2 ? ["-lstdc++"] : [] };
      }
      if (platform === OS.MacOS && process.env.FLANG_VERSION !== LATEST) {
        // The llvm.org tarballs ship libc++ headers that emit ODR ABI tags
        // their own dylib does not define, and their dylib set cannot be
        // linked through the Fortran driver with the new Apple linker
        // (reexport flattening breaks libc++abi initializer registration).
        // The brew install (LATEST) links fine.
        return {
          flags: [],
          skip: "llvm.org flang toolchains ship a C++ runtime that cannot be linked through the Fortran driver on macOS",
        };
      }
      // System clang++ companions match the system libc++ the drivers link.
      return { flags: [platform === OS.MacOS ? "-lc++" : "-lstdc++"] };
    case Compiler.LFortran:
      if (platform === OS.Windows) {
        return {
          flags: [],
          skip: `C++ companion linking not exercised for ${compiler} on windows yet`,
        };
      }
      // System clang++ companions match the system libc++ the drivers link.
      return { flags: [platform === OS.MacOS ? "-lc++" : "-lstdc++"] };
    case Compiler.IFort:
    case Compiler.IFX:
      if (platform === OS.Windows) {
        return {
          flags: [],
          skip: `C++ companion linking not exercised for ${compiler} on windows yet`,
        };
      }
      if (path.basename(process.env.CXX ?? "").startsWith("icpc")) {
        return {
          flags: [],
          skip: "the legacy icpc companion cannot parse modern libstdc++ headers",
        };
      }
      return { flags: ["-cxxlib"] };
    case Compiler.NVFortran: {
      // -lstdc++ is passed through to the linker and matches what the nvc++
      // companion links against. nvc++ before 23.11 used the EDG front end,
      // which cannot parse the _FloatN declarations in glibc >= 2.36 headers
      // (fails on ubuntu-24.04), and nvc++ before 21.11 additionally fails on
      // the __malloc__ attribute syntax of glibc 2.35 headers (ubuntu-22.04).
      // 21.11 through 23.9 still pass on glibc 2.35, and 23.11+ passes
      // everywhere; those combinations keep running.
      const version = nvcxxVersion;
      if (version !== undefined) {
        const legacy = isOlderThan(version, 23, 11);
        const tooOldForGlibc235 = isOlderThan(version, 21, 11);
        if (legacy && (tooOldForGlibc235 || (glibcVersion ?? 0) >= 2.36)) {
          return {
            flags: [],
            skip: `the nvc++ companion before 23.11 cannot parse glibc ${String(glibcVersion ?? "?")} headers`,
          };
        }
      }
      return { flags: ["-lstdc++"] };
    }
    default:
      return {
        flags: [],
        skip: `C++ companion linking not exercised for ${String(compiler)}`,
      };
  }
}

// Shared wording for compiler-capability skips; kept identical to the
// historical log output of the runner.
function notSupportedMessage(
  compiler: Compiler,
  flangVersion: Latest | number | undefined,
): string {
  return `not supported by ${compiler} ${(flangVersion ?? "").toString()} on ${process.platform}`;
}

/**
 * Everything the integration tests need to know about the toolchain and
 * environment, resolved once up front so individual test cases can be
 * declared as plain data plus small pure predicates.
 */
interface TestContext {
  compiler: Compiler;
  platform: OS;
  isWindows: boolean;
  isDarwin: boolean;
  isFlang: boolean;
  isLFortran: boolean;
  isUCRT64: boolean;
  isMSYS2: boolean;
  flangVersion: Latest | number | undefined;
  glibcVersion: number | undefined;
  nvcxxVersion: NvcxxVersion | undefined;
  cppFlags: string[];
  openmpFlags: string[];
}

/** Non-Fortran source compiled separately and linked into the test binary. */
interface CompanionSource {
  language: "c" | "cxx";
  source: string;
}

interface TestCase {
  name: string;
  fortranSources: string[];
  companion?: CompanionSource;
  /** Extra Fortran compile/link flags, resolved from the context. */
  extraFlags?: (ctx: TestContext) => string[];
  /** Returns a human-readable reason when the test must be skipped. */
  skipReason?: (ctx: TestContext) => string | undefined;
}

/**
 * The integration test suite as data: each case names its Fortran sources,
 * optionally links a C/C++ companion, and carries pure predicates for extra
 * flags and version/platform-gated skips. Adding a test means adding an entry
 * here rather than another branch in the runner.
 */
function buildTestManifest(): TestCase[] {
  return [
    {
      name: "iso_fortran_env_test",
      fortranSources: ["iso_fortran_env_test.f90"],
    },
    {
      name: "math_test",
      fortranSources: ["math_test.f90"],
    },
    {
      name: "c_interop_test",
      // Capital-F extensions imply preprocessing for gfortran/flang, but
      // lfortran requires an explicit flag; Intel on Windows uses -fpp.
      fortranSources: ["c_interop_test.F90"],
      extraFlags: (ctx) => ctx.cppFlags,
    },
    {
      name: "mixed_cc_test",
      fortranSources: ["mixed_cc_test.f90"],
      companion: { language: "c", source: "cc_test.c" },
    },
    {
      name: "mixed_cxx_test",
      fortranSources: ["mixed_cxx_test.f90"],
      companion: { language: "cxx", source: "cxx_test.cpp" },
      extraFlags: (ctx) =>
        getCxxLinkFlags(
          ctx.compiler,
          ctx.platform,
          ctx.isMSYS2,
          ctx.glibcVersion,
          ctx.nvcxxVersion,
        ).flags,
      skipReason: (ctx) =>
        getCxxLinkFlags(
          ctx.compiler,
          ctx.platform,
          ctx.isMSYS2,
          ctx.glibcVersion,
          ctx.nvcxxVersion,
        ).skip,
    },
    {
      name: "polymorphism_test",
      fortranSources: ["polymorphism_mod_test.f90", "polymorphism_test.f90"],
      // Flang gained the required OOP support in LLVM 19.
      skipReason: ({ compiler, isFlang, flangVersion }): string | undefined => {
        const tooOldFlang =
          isFlang &&
          flangVersion !== undefined &&
          flangVersion !== LATEST &&
          flangVersion < 19;
        return tooOldFlang
          ? notSupportedMessage(compiler, flangVersion)
          : undefined;
      },
    },
    {
      name: "omp_test",
      fortranSources: ["omp_test.f90"],
      extraFlags: (ctx) => ctx.openmpFlags,
      skipReason: ({
        compiler,
        isFlang,
        isLFortran,
        isDarwin,
        flangVersion,
      }): string | undefined => {
        // lfortran does not implement OpenMP yet. For flang, pinned llvm.org
        // tarballs on macOS don't provide a working OpenMP runtime (brew
        // LATEST does); the MSYS2 installer ships llvm-openmp so Windows works.
        const unsupportedFlangOnDarwin =
          isDarwin &&
          !!flangVersion &&
          flangVersion !== LATEST &&
          flangVersion < 23;
        return isLFortran || (isFlang && unsupportedFlangOnDarwin)
          ? notSupportedMessage(compiler, flangVersion)
          : undefined;
      },
    },
  ];
}

async function run(): Promise<void> {
  const repoRoot = process.env.GITHUB_WORKSPACE ?? process.cwd();
  const buildDir = path.join(repoRoot, "test_build");

  try {
    const fc = process.env.FC;
    if (!fc) {
      throw new Error(
        "FC environment variable is not set. Please fix the installer.",
      );
    }

    const cc = process.env.CC;
    if (!cc) {
      throw new Error(
        "CC environment variable is not set. Please fix the installer.",
      );
    }

    const cxx = process.env.CXX;
    if (!cxx) {
      throw new Error(
        "CXX environment variable is not set. Please fix the installer.",
      );
    }

    const compiler = process.env.FORTRAN_COMPILER as Compiler | undefined;
    if (!compiler) {
      throw new Error(
        "FORTRAN_COMPILER environment variable is not set. Please fix the installer.",
      );
    }

    function parseFlangVersion(
      raw: string | undefined,
    ): Latest | number | undefined {
      if (raw === undefined) return undefined;
      if (raw === LATEST) return LATEST;
      const n = parseInt(raw, 10);
      if (isNaN(n))
        throw new Error(
          `Invalid FLANG_VERSION: "${raw}". Expected "latest" or an integer.`,
        );
      return n;
    }

    const flangVersion = parseFlangVersion(process.env.FLANG_VERSION);
    const msystem = process.env.WINDOWS_ENV as Msystem | undefined;
    const isUCRT64 = msystem === Msystem.UCRT64;
    const isMSYS2 = isUCRT64 || msystem === Msystem.Clang64;

    const rawPlatform = process.platform;
    if (!Object.values(OS).includes(rawPlatform as OS)) {
      throw new Error(`Unsupported or missing platform: ${rawPlatform}`);
    }

    const platform = rawPlatform as OS;
    const isWindows = platform === OS.Windows;
    const isDarwin = platform === OS.MacOS;
    const isLFortran = compiler === Compiler.LFortran;
    const isFlang = compiler === Compiler.Flang;

    const testDir = path.join(repoRoot, "fortran_tests");

    if (!fs.existsSync(buildDir)) {
      fs.mkdirSync(buildDir);
    }

    core.info(`Starting integration tests for ${fc} in ${buildDir}...`);

    const {
      module: moduleFlags,
      openmp: ompFlag,
      linkerFlags: linkerFlags,
    } = getCompilerFlags(compiler, isWindows);
    const cppFlags = getCppFlags(compiler, isWindows);
    const baseFlags = ["-O2", ...moduleFlags];

    const execTest = async (
      name: string,
      sources: string[],
      extraFlags: string[] = [],
    ): Promise<void> => {
      const outputPath = path.join(buildDir, isWindows ? `${name}.exe` : name);
      const sourcePaths = sources.map((s) => path.join(testDir, s));
      const fflags = (process.env.FFLAGS ?? "").split(" ").filter(Boolean);

      core.startGroup(`Test: ${name}`);
      await exec.exec(fc, [
        ...baseFlags,
        ...fflags,
        ...extraFlags,
        ...linkerFlags,
        ...sourcePaths,
        "-o",
        outputPath,
      ]);
      await exec.exec(outputPath);
      core.endGroup();
    };

    /**
     * Compile a standalone C source to an object file, then link it with a
     * Fortran source into a single executable. This verifies that the
     * companion C compiler ($CC) is functional and that the Fortran compiler
     * can interoperate with C at the link level.
     */
    const execMixedCTest = async (
      name: string,
      fortranSources: string[],
      cSource: string,
      extraFlags: string[] = [],
    ): Promise<void> => {
      const fortranPath = path.join(testDir, fortranSources[0]);
      const cPath = path.join(testDir, cSource);
      // MSVC-style compilers (icl/cl) use /Fo: and .obj; GCC/Clang use -o and .o
      const isMsvc =
        isWindows && (compiler === Compiler.IFort || compiler === Compiler.IFX);
      const objExt = isMsvc ? ".obj" : ".o";
      const objPath = path.join(buildDir, `${name}${objExt}`);
      const outputPath = path.join(buildDir, isWindows ? `${name}.exe` : name);
      const fflags = (process.env.FFLAGS ?? "").split(" ").filter(Boolean);
      const cflags = (process.env.CFLAGS ?? "").split(" ").filter(Boolean);

      core.startGroup(`Test: ${name}`);

      // Compile C source to object file using $CC
      if (isMsvc) {
        await exec.exec(cc, ["/c", `/Fo:${objPath}`, cPath]);
      } else {
        await exec.exec(cc, ["-c", ...cflags, "-o", objPath, cPath]);
      }

      // Link Fortran + C object into final executable. Extra link flags
      // (e.g. -lstdc++ for the C++ companion) must come AFTER the object
      // files: GNU ld defaults to --as-needed, so a library encountered
      // before the objects that reference it is discarded, producing
      // unresolved-symbol errors (notably on Ubuntu and Windows mingw).
      await exec.exec(fc, [
        ...baseFlags,
        ...fflags,
        fortranPath,
        objPath,
        ...extraFlags,
        ...linkerFlags,
        "-o",
        outputPath,
      ]);

      await exec.exec(outputPath);
      core.endGroup();
    };

    const skipTest = (name: string, reason: string): void => {
      core.info(`Skipping ${name}: ${reason}`);
    };

    /**
     * Compile a standalone C++ source to an object file, then link it with a
     * Fortran source into a single executable. The C++ source uses the C++
     * standard library internally, so the link verifies that the companion
     * C++ runtime is reachable from the Fortran driver.
     */
    const execMixedCxxTest = async (
      name: string,
      fortranSources: string[],
      cxxSource: string,
      extraFlags: string[] = [],
    ): Promise<void> => {
      const fortranPath = path.join(testDir, fortranSources[0]);
      const cxxPath = path.join(testDir, cxxSource);
      // MSVC-style compilers (cl) use /Fo: and .obj; GCC/Clang use -o and .o
      const isMsvc =
        isWindows && (compiler === Compiler.IFort || compiler === Compiler.IFX);
      const objExt = isMsvc ? ".obj" : ".o";
      const objPath = path.join(buildDir, `${name}${objExt}`);
      const outputPath = path.join(buildDir, isWindows ? `${name}.exe` : name);
      const fflags = (process.env.FFLAGS ?? "").split(" ").filter(Boolean);
      const cxxflags = (process.env.CXXFLAGS ?? "").split(" ").filter(Boolean);

      core.startGroup(`Test: ${name}`);

      if (isMsvc) {
        await exec.exec(cxx, ["/EHsc", "/c", `/Fo:${objPath}`, cxxPath]);
      } else {
        await exec.exec(cxx, ["-c", ...cxxflags, "-o", objPath, cxxPath]);
      }

      await exec.exec(fc, [
        ...baseFlags,
        ...fflags,
        fortranPath,
        objPath,
        ...extraFlags,
        ...linkerFlags,
        "-o",
        outputPath,
      ]);

      await exec.exec(outputPath);
      core.endGroup();
    };

    // Toolchain probes are silent best-effort queries; resolve them once so
    // the manifest cases below can stay pure functions of the context.
    const glibcVersion =
      platform === OS.Linux ? await detectGlibcVersion() : undefined;
    const nvcxxVersion =
      compiler === Compiler.NVFortran ? await detectNvcxxVersion() : undefined;

    const ctx: TestContext = {
      compiler,
      platform,
      isWindows,
      isDarwin,
      isFlang,
      isLFortran,
      isUCRT64,
      isMSYS2,
      flangVersion,
      glibcVersion,
      nvcxxVersion,
      cppFlags,
      openmpFlags: [
        ...ompFlag,
        // The MSYS2 llvm-openmp package installs omp_lib.mod in the
        // environment's include dir, which the flang driver does not search
        // by default.
        ...(isFlang && isMSYS2
          ? [
              "-I",
              path.join(MSYS2_ROOT, msystem, "include").replace(/\\/g, "/"),
            ]
          : []),
      ],
    };

    for (const test of buildTestManifest()) {
      const skipReason = test.skipReason?.(ctx);
      if (skipReason !== undefined) {
        skipTest(test.name, skipReason);
        continue;
      }

      const extraFlags = test.extraFlags?.(ctx) ?? [];
      if (!test.companion) {
        await execTest(test.name, test.fortranSources, extraFlags);
      } else if (test.companion.language === "c") {
        await execMixedCTest(
          test.name,
          test.fortranSources,
          test.companion.source,
          extraFlags,
        );
      } else {
        await execMixedCxxTest(
          test.name,
          test.fortranSources,
          test.companion.source,
          extraFlags,
        );
      }
    }

    core.info("All integration tests passed successfully!");
  } catch (error) {
    if (error instanceof Error) {
      core.setFailed(`Integration tests failed: ${error.message}`);
    }
    process.exit(1);
  } finally {
    if (fs.existsSync(buildDir)) {
      core.info("Cleaning up test artifacts...");
      fs.rmSync(buildDir, { recursive: true, force: true });
    }
  }
}

void run();
