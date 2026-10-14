import * as core from "@actions/core";
import * as exec from "@actions/exec";
import * as fs from "fs";
import * as os from "os";
import path from "path";
import { validateRestoredCompilerCache } from "./cache_validation";
import { addIntelCompilerBinFromPath, addMsvcBinFromPath } from "./setup_msvc";

const CAPTURED_ENV_KEY_PATTERN =
  /^(PATH|LIB|INCLUDE|.*INTEL.*|.*ONEAPI.*|.*MKL.*|MKLROOT|CMPLR_ROOT)$/i;

function intelEnvironmentBatchLines(setvarsBat: string): string[] {
  return [
    `@echo off`,
    `:: 1. Find MSVC Installation Path via vswhere`,
    `for /f "usebackq tokens=*" %%i in (\`"%ProgramFiles(x86)%\\Microsoft Visual Studio\\Installer\\vswhere.exe" -latest -property installationPath\`) do set VS_INSTALL_DIR=%%i`,

    `:: 2. Initialize MSVC Environment Natively`,
    `if exist "%VS_INSTALL_DIR%\\VC\\Auxiliary\\Build\\vcvars64.bat" call "%VS_INSTALL_DIR%\\VC\\Auxiliary\\Build\\vcvars64.bat"`,

    `:: 3. Call Intel's setvars.bat (it will detect MSVC is already active)`,
    `call "${setvarsBat}" --force`,
  ];
}

export async function validateRestoredIntelWindowsCache(
  label: string,
  setvarsBat: string,
  compiler: string,
): Promise<boolean> {
  const batFile = path.win32.join(os.tmpdir(), `validate_${compiler}.bat`);
  fs.writeFileSync(
    batFile,
    [...intelEnvironmentBatchLines(setvarsBat), `${compiler} /QV`].join("\r\n"),
  );
  return validateRestoredCompilerCache(label, [setvarsBat], "cmd", [
    "/C",
    batFile,
  ]);
}

/**
 * Runs vcvars64.bat, then Intel's setvars.bat, and exports the combined
 * environment so ifx/ifort can link against MSVC. Shared by both installers.
 */
export async function captureIntelWindowsEnvironment(
  setvarsBat: string,
  batchFileName: string,
): Promise<void> {
  const batFile = path.win32.join(os.tmpdir(), batchFileName);

  fs.writeFileSync(
    batFile,
    [
      ...intelEnvironmentBatchLines(setvarsBat),
      `:: 4. Dump the fully combined environment`,
      `set`,
    ].join("\r\n"),
  );

  let envOutput = "";
  await exec.exec("cmd", ["/C", batFile], {
    listeners: {
      stdout: (data: Buffer) => {
        envOutput += data.toString();
      },
    },
  });

  for (const line of envOutput.split("\n")) {
    const eqIdx = line.indexOf("=");
    if (eqIdx === -1) continue;
    const key = line.substring(0, eqIdx).trim();
    const val = line.substring(eqIdx + 1).trimEnd();

    if (!CAPTURED_ENV_KEY_PATTERN.test(key)) continue;

    if (key.toUpperCase() === "PATH") {
      // Drop Git's link.exe (it breaks MSVC's linker with "extra operand"
      // errors) and dedupe entries, so a redundant setvars/vcvarsall call
      // can't push PATH past cmd.exe's line-length limit (#250).
      const seenPathEntries = new Set<string>();
      const filteredPath = val
        .split(";")
        .filter((p) => !p.toLowerCase().includes("git\\usr\\bin"))
        .filter((p) => {
          if (p === "") return false;
          const key = p.toLowerCase();
          if (seenPathEntries.has(key)) return false;
          seenPathEntries.add(key);
          return true;
        })
        .join(";");
      core.exportVariable("PATH", filteredPath);
      addMsvcBinFromPath(filteredPath);
      addIntelCompilerBinFromPath(filteredPath);
    } else {
      core.exportVariable(key, val);
    }
  }
}
