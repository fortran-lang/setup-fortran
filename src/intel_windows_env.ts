import * as core from "@actions/core";
import * as exec from "@actions/exec";
import * as fs from "fs";
import * as os from "os";
import path from "path";
import { addMsvcBinFromPath } from "./setup_msvc";

const CAPTURED_ENV_KEY_PATTERN =
  /^(PATH|LIB|INCLUDE|.*INTEL.*|.*ONEAPI.*|.*MKL.*|MKLROOT|CMPLR_ROOT)$/i;

/**
 * Initializes MSVC (via vcvars64.bat) and Intel's oneAPI environment (via
 * setvarsBat), then exports the combined environment. Shared by ifx and
 * ifort on Windows, which both need MSVC active before setvars.bat runs so
 * ifx/ifort can link against cl.
 */
export async function captureIntelWindowsEnvironment(
  setvarsBat: string,
  batchFileName: string,
): Promise<void> {
  // Create a temporary batch file to capture the environment variables
  const batFile = path.win32.join(os.tmpdir(), batchFileName);

  fs.writeFileSync(
    batFile,
    [
      `@echo off`,
      `:: 1. Find MSVC Installation Path via vswhere`,
      `for /f "usebackq tokens=*" %%i in (\`"%ProgramFiles(x86)%\\Microsoft Visual Studio\\Installer\\vswhere.exe" -latest -property installationPath\`) do set VS_INSTALL_DIR=%%i`,

      `:: 2. Initialize MSVC Environment Natively`,
      `if exist "%VS_INSTALL_DIR%\\VC\\Auxiliary\\Build\\vcvars64.bat" call "%VS_INSTALL_DIR%\\VC\\Auxiliary\\Build\\vcvars64.bat"`,

      `:: 3. Call Intel's setvars.bat (it will detect MSVC is already active)`,
      `call "${setvarsBat}" --force`,

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
      // Keep the filter to remove Git's link.exe to prevent "extra operand" errors.
      // Since vcvars64.bat already prepended MSVC's link.exe to the PATH,
      // we no longer need the secondary TypeScript vswhere lookup.
      const filteredPath = val
        .split(";")
        .filter((p) => !p.toLowerCase().includes("git\\usr\\bin"))
        .join(";");
      core.exportVariable("PATH", filteredPath);
      addMsvcBinFromPath(filteredPath);
    } else {
      core.exportVariable(key, val);
    }
  }
}
