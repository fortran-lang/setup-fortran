import * as exec from "@actions/exec";
import * as cache from "@actions/cache";
import * as tc from "@actions/tool-cache";
import { spawnSync } from "child_process";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { installWin32 as installIfort } from "../../src/installers/ifort/win32";
import { installWin32 as installIfx } from "../../src/installers/ifx/win32";
import { Arch, Compiler, OS, Msystem, type Inputs } from "../../src/types";

jest.mock("@actions/core");
jest.mock("@actions/cache");
jest.mock("@actions/tool-cache");
jest.mock("@actions/exec");
jest.mock("../../src/verify_download");
jest.mock("fs", () => ({
  ...jest.requireActual("fs"),
  writeFileSync: jest.fn(),
  existsSync: jest.fn(),
  mkdirSync: jest.fn(),
  rmSync: jest.fn(),
}));

// Jest cannot load the ESM-only @actions/exec, so run it in a child process.
const RUN_WITH_ACTIONS_EXEC = `
  import { exec } from "@actions/exec";
  const options = { ignoreReturnCode: true, silent: true };
  process.exit(await exec("cmd", ["/C", process.env.BATCH_FILE], options));
`;

const realFs = jest.requireActual<typeof fs>("fs");
const describeOnWindows =
  process.platform === "win32" ? describe : describe.skip;

const SETVARS_BAT = "C:\\Program Files (x86)\\Intel\\oneAPI\\setvars.bat";

const COMPILERS = [
  { compiler: Compiler.IFX, version: "2026.0.0", install: installIfx },
  { compiler: Compiler.IFort, version: "2021.13", install: installIfort },
];

const mockedExec = exec.exec as jest.MockedFunction<typeof exec.exec>;
const mockedDownloadTool = tc.downloadTool as jest.MockedFunction<
  typeof tc.downloadTool
>;

function inputsFor(compiler: Compiler, version: string): Inputs {
  return {
    compiler,
    version,
    os: OS.Windows,
    osVersion: "10.0.19045",
    arch: Arch.X64,
    cleanupDisk: false,
    updateEnvironment: true,
    msystem: Msystem.Native,
  };
}

function isValidation(args: string[] | undefined): boolean {
  return /validate_\w+\.bat$/.test(args?.[1] ?? "");
}

function validationBatch(): string {
  const call = (fs.writeFileSync as jest.Mock).mock.calls.find(([file]) =>
    /validate_\w+\.bat$/.test(String(file)),
  );
  return String(call?.[1]);
}

beforeEach(() => {
  jest.clearAllMocks();
  (fs.existsSync as jest.Mock).mockReturnValue(true);
  (cache.restoreCache as jest.Mock).mockResolvedValue("cache-hit");
  mockedDownloadTool.mockResolvedValue("C:\\Temp\\installer.exe");
  mockedExec.mockImplementation(async (_commandLine, _args, options) => {
    options?.listeners?.stdout?.(Buffer.from("PATH=C:\\bin"));
    return 0;
  });
});

describe.each(COMPILERS)(
  "restored $compiler cache validation batch file",
  ({ compiler, version, install }) => {
    it("initializes MSVC, then oneAPI, then runs the compiler", async () => {
      await install(inputsFor(compiler, version));

      const lines = validationBatch().split("\r\n");
      const vcvars = lines.findIndex((line) => line.includes("vcvars64.bat"));
      const setvars = lines.indexOf(`call "${SETVARS_BAT}" --force`);
      expect(vcvars).toBeGreaterThan(-1);
      expect(setvars).toBeGreaterThan(vcvars);
      expect(lines.at(-1)).toBe(`${compiler} /QV`);
      expect(mockedExec.mock.calls.some(([, args]) => isValidation(args))).toBe(
        true,
      );
      expect(mockedDownloadTool).not.toHaveBeenCalled();
    });
  },
);

describeOnWindows.each(COMPILERS)(
  "restored $compiler cache validation in cmd.exe",
  ({ compiler, version, install }) => {
    let oneApiDir: string;

    function writeCompiler(exitCode: number): void {
      realFs.mkdirSync(path.join(oneApiDir, "bin"));
      realFs.writeFileSync(
        path.join(oneApiDir, "bin", `${compiler}.cmd`),
        `@exit /b ${exitCode.toString()}`,
      );
    }

    function runValidationBatch(): number {
      const batchFile = path.join(oneApiDir, "validate.bat");
      realFs.writeFileSync(
        batchFile,
        validationBatch().replace(
          SETVARS_BAT,
          path.join(oneApiDir, "setvars.bat"),
        ),
      );
      const result = spawnSync(
        process.execPath,
        ["--input-type=module", "-e", RUN_WITH_ACTIONS_EXEC],
        { env: { ...process.env, BATCH_FILE: batchFile } },
      );
      return result.status ?? -1;
    }

    beforeEach(() => {
      oneApiDir = realFs.mkdtempSync(path.join(os.tmpdir(), "oneAPI (x86) "));
      realFs.writeFileSync(
        path.join(oneApiDir, "setvars.bat"),
        'set "PATH=%~dp0bin;%SystemRoot%\\System32"',
      );
      mockedExec.mockImplementation(async (_commandLine, args, options) => {
        if (isValidation(args)) return runValidationBatch();
        options?.listeners?.stdout?.(Buffer.from("PATH=C:\\bin"));
        return 0;
      });
    });

    afterEach(() => {
      realFs.rmSync(oneApiDir, { recursive: true, force: true });
    });

    it("accepts a working installation", async () => {
      writeCompiler(0);

      await install(inputsFor(compiler, version));

      expect(mockedDownloadTool).not.toHaveBeenCalled();
    }, 60_000);

    it("reinstalls when the compiler is missing", async () => {
      await install(inputsFor(compiler, version));

      expect(mockedDownloadTool).toHaveBeenCalled();
    }, 60_000);

    it("reinstalls when the compiler fails", async () => {
      writeCompiler(1);

      await install(inputsFor(compiler, version));

      expect(mockedDownloadTool).toHaveBeenCalled();
    }, 60_000);
  },
);
