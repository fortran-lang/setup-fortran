import * as exec from "@actions/exec";
import * as core from "@actions/core";
import * as path from "path";
import * as fs from "fs";
import { Compiler, LATEST, OS, Msystem, type Latest } from "./types";

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

// Link flags for the Fortran driver when linking C++ objects: the C++ standard
// library must be pulled in explicitly, and the correct one depends on the
// companion C++ compiler (GNU g++ links libstdc++, clang++ companions link
// libc++ on macOS, Intel and NVIDIA have dedicated options). Returns a skip
// reason for combinations that are not exercised yet.
function getCxxLinkFlags(
  compiler: Compiler,
  platform: OS,
): { flags: string[]; skip?: string } {
  switch (compiler) {
    case Compiler.GFortran:
    case Compiler.AOCC:
    case Compiler.ArmFlang:
      // GNU g++-style companions (brew g++ on macOS, g++ on Linux).
      return { flags: ["-lstdc++"] };
    case Compiler.Flang:
    case Compiler.LFortran:
      if (platform === OS.Windows) {
        return {
          flags: [],
          skip: `C++ companion linking not exercised for ${compiler} on windows yet`,
        };
      }
      // clang++ companions: libc++ on macOS, libstdc++ on Linux.
      return { flags: [platform === OS.MacOS ? "-lc++" : "-lstdc++"] };
    case Compiler.IFort:
    case Compiler.IFX:
      if (platform === OS.Windows) {
        return {
          flags: [],
          skip: `C++ companion linking not exercised for ${compiler} on windows yet`,
        };
      }
      return { flags: ["-cxxlib"] };
    case Compiler.NVFortran:
      return { flags: ["-cxxstdlib"] };
    default:
      return {
        flags: [],
        skip: `C++ companion linking not exercised for ${String(compiler)}`,
      };
  }
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

      // Link Fortran + C object into final executable
      const linkFlags = [objPath];
      await exec.exec(fc, [
        ...baseFlags,
        ...fflags,
        fortranPath,
        ...linkFlags,
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
        ...cxxLinkFlags,
        ...linkerFlags,
        "-o",
        outputPath,
      ]);

      await exec.exec(outputPath);
      core.endGroup();
    };

    await execTest("iso_fortran_env_test", ["iso_fortran_env_test.f90"]);
    await execTest("math_test", ["math_test.f90"]);
    await execTest("c_interop_test", ["c_interop_test.F90"], cppFlags);
    await execMixedCTest("mixed_cc_test", ["mixed_cc_test.f90"], "cc_test.c");

    const { flags: cxxLinkFlags, skip: skipCxxLink } = getCxxLinkFlags(
      compiler,
      platform,
    );
    if (skipCxxLink) {
      skipTest("mixed_cxx_test", skipCxxLink);
    } else {
      await execMixedCxxTest(
        "mixed_cxx_test",
        ["mixed_cxx_test.f90"],
        "cxx_test.cpp",
      );
    }

    const skipPoly =
      isFlang &&
      ((flangVersion !== undefined &&
        flangVersion !== LATEST &&
        flangVersion < 19) ||
        isUCRT64);

    if (!skipPoly) {
      await execTest("polymorphism_test", [
        "polymorphism_mod_test.f90",
        "polymorphism_test.f90",
      ]);
    } else {
      skipTest(
        "polymorphism_test",
        `not supported by ${compiler} ${(flangVersion ?? "").toString()} on ${process.platform}`,
      );
    }

    const isUnsupportedFlangOnDarwin =
      isDarwin && flangVersion && flangVersion !== LATEST && flangVersion < 23; // LATEST from brew works, let's check with version 23 if installation from source works, too
    const skipOmp =
      isLFortran ||
      (isFlang && (isUnsupportedFlangOnDarwin === true || isMSYS2));
    if (!skipOmp) {
      await execTest("omp_test", ["omp_test.f90"], ompFlag);
    } else {
      skipTest(
        "omp_test",
        `not supported by ${compiler} ${(
          flangVersion ?? ""
        ).toString()} on ${process.platform}`,
      );
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
