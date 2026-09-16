import { execFileSync } from "child_process";
import { mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { normalizeWindowsExecutablePath } from "./windows_executable_path";

function toBashPath(windowsPath: string): string {
  const normalized = windowsPath.replace(/\\/g, "/");
  return normalized.replace(
    /^([a-z]):\//i,
    (_, drive: string) => `/${drive.toLowerCase()}/`,
  );
}

function verifyNativeWindowsTools(): void {
  if (
    process.platform !== "win32" ||
    process.env.WINDOWS_ENV ||
    !/^(flang|ifort|ifx)$/.test(process.env.FORTRAN_COMPILER ?? "")
  ) {
    return;
  }

  let msvcLink: string | undefined;
  for (const tool of ["link.exe", "lib.exe"]) {
    const resolved = execFileSync("where.exe", [tool], {
      encoding: "utf8",
    })
      .split(/\r?\n/)
      .filter(Boolean);
    const msvcTool = resolved.find((candidate) =>
      candidate.toLowerCase().includes("\\vc\\tools\\msvc\\"),
    );

    if (!msvcTool) {
      throw new Error(
        `${tool} is not available from the configured MSVC toolchain. ` +
          `Resolved paths: ${resolved.join(", ") || "none"}`,
      );
    }

    if (tool === "link.exe") msvcLink = msvcTool;
  }

  if (!msvcLink) throw new Error("Could not resolve the MSVC linker.");

  const testDir = mkdtempSync(join(tmpdir(), "setup-fortran-link-"));
  const source = join(testDir, "verify_link.f90");
  const executable = join(testDir, "verify_link.exe");

  try {
    writeFileSync(
      source,
      [
        "program verify_link",
        '  print *, "setup-fortran link verification successful"',
        "end program verify_link",
        "",
      ].join("\n"),
    );

    const bashEnvironment = {
      ...process.env,
      VERIFY_SOURCE: toBashPath(source),
      VERIFY_EXECUTABLE: toBashPath(executable),
    };
    const resolvedLink = execFileSync(
      "bash.exe",
      ["--noprofile", "--norc", "-c", "command -v link"],
      {
        encoding: "utf8",
        env: bashEnvironment,
      },
    );
    const expectedLink = toBashPath(msvcLink);
    if (
      normalizeWindowsExecutablePath(resolvedLink) !==
      normalizeWindowsExecutablePath(expectedLink)
    ) {
      throw new Error(
        `Bash resolved link to ${resolvedLink.trim()} instead of ${expectedLink}`,
      );
    }

    execFileSync(
      "bash.exe",
      [
        "--noprofile",
        "--norc",
        "-e",
        "-o",
        "pipefail",
        "-c",
        '"$FC" "$VERIFY_SOURCE" -o "$VERIFY_EXECUTABLE"\n"$VERIFY_EXECUTABLE"',
      ],
      { stdio: "inherit", env: bashEnvironment },
    );
  } finally {
    rmSync(testDir, { recursive: true, force: true });
  }
}

/**
 * Verify that the advertised C and C++ companion compilers ($CC / $CXX) are
 * actually installed and callable, not merely set as environment variables.
 * This catches cases like ifort 2024+ bundles where `icc`/`icpc` may no
 * longer be provided even though the action returns those names.
 */
function verifyCompanionCompilers(): void {
  const cc = process.env.CC;
  const cxx = process.env.CXX;

  if (!cc || !cxx) {
    throw new Error(
      `Cannot verify companion compilers: CC=${cc ?? "unset"}, CXX=${cxx ?? "unset"}`,
    );
  }

  // Verify F77 and F90 aliases match FC — downstream build systems
  // (autotools, CMake FindFortran) may use F77/F90 instead of FC
  const fc = process.env.FC;
  if (!fc) {
    throw new Error("FC is not set; cannot check F77/F90 sync.");
  }
  if (process.env.F77 !== fc) {
    throw new Error(
      `F77 env var (${process.env.F77 ?? "unset"}) does not match FC (${fc}).`,
    );
  }
  if (process.env.F90 !== fc) {
    throw new Error(
      `F90 env var (${process.env.F90 ?? "unset"}) does not match FC ($fc).`,
    );
  }

  const isWindows = process.platform === "win32";
  const checkTool = (tool: string, label: string): void => {
    try {
      if (isWindows) {
        // `where.exe` only accepts a *filename pattern* to search for on PATH;
        // passing an absolute path (which the gfortran/flang/lfortran
        // installers advertise as $CC/$CXX) always fails with exit code 1.
        // Invoke the compiler directly instead, mirroring the pwsh/cmd
        // shell checks that run in CI.
        try {
          execFileSync(tool, ["--version"], {
            encoding: "utf8",
            stdio: "pipe",
          });
        } catch {
          // MSVC-style compilers (e.g. icl) reject `--version`.
          execFileSync(tool, ["/?"], { encoding: "utf8", stdio: "pipe" });
        }
      } else {
        execFileSync(tool, ["--version"], {
          encoding: "utf8",
          stdio: "pipe",
        });
      }
    } catch {
      throw new Error(
        `Companion compiler ${label}="${tool}" is not callable. ` +
          `The action advertised this compiler but it could not be executed.`,
      );
    }
  };

  checkTool(cc, "CC");
  checkTool(cxx, "CXX");
}

/**
 * Verify that the Fortran compiler can be discovered by its unversioned
 * driver name (e.g. `gfortran` rather than `gfortran-14`). Some downstream
 * workflows invoke `command -v gfortran` directly.
 */
function verifyUnversionedExecutable(): void {
  const fc = process.env.FC;
  if (!fc) {
    throw new Error("FC is not set; cannot check unversioned discovery.");
  }

  // Use the unversioned driver name downstream workflows actually invoke,
  // not the versioned $FC. `aocc` is a distribution selector, not an
  // executable: the driver it installs is `flang`.
  const DRIVER_NAMES: Record<string, string> = { aocc: "flang" };
  const compilerName = process.env.FORTRAN_COMPILER ?? "";
  if (!compilerName) {
    throw new Error(
      "FORTRAN_COMPILER is not set; cannot check unversioned discovery.",
    );
  }

  const driverName = DRIVER_NAMES[compilerName] ?? compilerName;
  const isWindows = process.platform === "win32";
  // On Windows, `where.exe` locates executables with or without the `.exe`
  // suffix, so we strip it for a cleaner lookup.
  const lookupName = isWindows ? driverName.replace(/\.exe$/i, "") : driverName;

  try {
    if (isWindows) {
      execFileSync("where.exe", [lookupName], {
        encoding: "utf8",
        stdio: "pipe",
      });
    } else {
      execFileSync("command", ["-v", lookupName], {
        encoding: "utf8",
        stdio: "pipe",
        shell: true,
      });
    }
  } catch {
    throw new Error(
      `Unversioned Fortran compiler "${lookupName}" is not discoverable on PATH. ` +
        `Downstream workflows that call \`command -v ${lookupName}\` will fail.`,
    );
  }
}

/**
 * Verify that Intel oneAPI environment variables were propagated from
 * `setvars.sh`/`setvars.bat`. The installers filter and export a subset
 * including LIBRARY_PATH, CPATH, CMAKE_PREFIX_PATH, and oneAPI-specific vars.
 */
function verifyIntelEnv(): void {
  const fortranCompiler = process.env.FORTRAN_COMPILER ?? "";
  if (!["ifx", "ifort"].includes(fortranCompiler)) {
    return;
  }

  const intelVars = Object.entries(process.env).filter(([key]) =>
    /^.*(INTEL|ONEAPI|MKL|LIBRARY_PATH|CPATH|CMAKE_PREFIX_PATH|CMAKE_MODULE_PATH)$/i.test(
      key,
    ),
  );

  if (intelVars.length === 0) {
    throw new Error(
      `Intel compiler ${fortranCompiler} installed but no oneAPI environment ` +
        "variables were propagated. Expected at least one of: LIBRARY_PATH, " +
        "CPATH, CMAKE_PREFIX_PATH, and INTEL/ONEAPI/MKL vars.",
    );
  }

  console.log(
    `Intel environment verified: ${String(intelVars.length)} oneAPI vars propagated.`,
  );
}

/**
 * Verify that NVIDIA HPC environment variables are available. The installer
 * exports LD_LIBRARY_PATH including the NVIDIA lib directory.
 */
function verifyNvidiaEnv(): void {
  const fortranCompiler = process.env.FORTRAN_COMPILER ?? "";
  if (fortranCompiler !== "nvfortran") {
    return;
  }

  const ldLibraryPath = process.env.LD_LIBRARY_PATH ?? "";
  if (!ldLibraryPath) {
    throw new Error(
      "NVIDIA HPC compiler installed but LD_LIBRARY_PATH is not set. " +
        "The NVIDIA lib directory should be on LD_LIBRARY_PATH for runtime.",
    );
  }
}

function run(): void {
  try {
    const fc = process.env.FC;
    const cc = process.env.CC;
    const cxx = process.env.CXX;
    const fpmFc = process.env.FPM_FC;
    const fpmCc = process.env.FPM_CC;
    const fpmCxx = process.env.FPM_CXX;
    const f77 = process.env.F77;
    const f90 = process.env.F90;

    const outputFc = process.env.OUTPUT_FC;
    const outputCc = process.env.OUTPUT_CC;
    const outputCxx = process.env.OUTPUT_CXX;
    const outputVersion = process.env.OUTPUT_VERSION;

    const envs: Record<string, string | undefined> = {
      FC: fc,
      CC: cc,
      CXX: cxx,
      FPM_FC: fpmFc,
      FPM_CC: fpmCc,
      FPM_CXX: fpmCxx,
      F77: f77,
      F90: f90,
      OUTPUT_FC: outputFc,
      OUTPUT_CC: outputCc,
      OUTPUT_CXX: outputCxx,
      OUTPUT_VERSION: outputVersion,
    };

    for (const [name, value] of Object.entries(envs)) {
      if (!value) {
        throw new Error(`${name} environment variable is not set.`);
      }
    }

    if (fc !== outputFc) {
      throw new Error(
        `FC (${String(fc)}) does not match OUTPUT_FC (${String(outputFc)})`,
      );
    }
    if (fpmFc !== outputFc) {
      throw new Error(
        `FPM_FC (${String(fpmFc)}) does not match OUTPUT_FC (${String(
          outputFc,
        )})`,
      );
    }
    if (f77 !== outputFc) {
      throw new Error(
        `F77 (${String(f77)}) does not match OUTPUT_FC (${String(outputFc)})`,
      );
    }
    if (f90 !== outputFc) {
      throw new Error(
        `F90 (${String(f90)}) does not match OUTPUT_FC (${String(outputFc)})`,
      );
    }

    if (cc !== outputCc) {
      throw new Error(
        `CC (${String(cc)}) does not match OUTPUT_CC (${String(outputCc)})`,
      );
    }
    if (fpmCc !== outputCc) {
      throw new Error(
        `FPM_CC (${String(fpmCc)}) does not match OUTPUT_CC (${String(
          outputCc,
        )})`,
      );
    }

    if (cxx !== outputCxx) {
      throw new Error(
        `CXX (${String(cxx)}) does not match OUTPUT_CXX (${String(outputCxx)})`,
      );
    }
    if (fpmCxx !== outputCxx) {
      throw new Error(
        `FPM_CXX (${String(fpmCxx)}) does not match OUTPUT_CXX (${String(
          outputCxx,
        )})`,
      );
    }

    verifyNativeWindowsTools();
    verifyCompanionCompilers();
    verifyUnversionedExecutable();
    verifyIntelEnv();
    verifyNvidiaEnv();

    console.log("Installation verification successful!");
  } catch (error) {
    if (error instanceof Error) {
      console.error(`::error::Verification failed: ${error.message}`);
    } else {
      console.error(`::error::Verification failed: ${String(error)}`);
    }
    process.exit(1);
  }
}

if (process.env.SETUP_FORTRAN_BUNDLE_SMOKE_TEST !== "1") {
  run();
}
