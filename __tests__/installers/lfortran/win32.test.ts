import * as core from "@actions/core";
import * as exec from "@actions/exec";
import * as fs from "fs";
import { installWin32 } from "../../../src/installers/lfortran/win32";
import { setupMSYS2 } from "../../../src/setup_msys2";
import { Arch, Compiler, OS, Msystem, type Inputs } from "../../../src/types";

jest.mock("@actions/core");
jest.mock("@actions/exec");
jest.mock("../../../src/setup_msys2");
jest.mock("../../../src/verify_download");
jest.mock("fs", () => ({
  ...jest.requireActual("fs"),
  existsSync: jest.fn(),
  renameSync: jest.fn(),
  copyFileSync: jest.fn(),
}));

describe("installWin32 (LFortran)", () => {
  const mockedExec = exec.exec as jest.MockedFunction<typeof exec.exec>;
  const mockedFs = fs as jest.Mocked<typeof fs>;
  const mockedSetupMSYS2 = setupMSYS2 as jest.MockedFunction<typeof setupMSYS2>;
  const mockedExportVariable = core.exportVariable as jest.MockedFunction<
    typeof core.exportVariable
  >;
  let environmentCreated: boolean;

  const baseInputs: Inputs = {
    compiler: Compiler.LFortran,
    version: "0.63.0",
    os: OS.Windows,
    osVersion: "2022",
    arch: Arch.X64,
    cleanupDisk: false,
    updateEnvironment: true,
    msystem: Msystem.Native,
  };

  beforeEach(() => {
    jest.clearAllMocks();
    environmentCreated = false;
    mockedSetupMSYS2.mockImplementation(async () => {
      environmentCreated = true;
    });
    mockedFs.existsSync.mockImplementation((filePath) => {
      if (String(filePath).endsWith("lld-link.exe")) return environmentCreated;
      return environmentCreated;
    });
    mockedExec.mockImplementation(async (commandLine, args, options) => {
      if (args?.[0] === "create") environmentCreated = true;
      if (args?.[0] === "run" && args.includes("lfortran")) {
        options?.listeners?.stdout?.(Buffer.from("LFortran version 0.63.0"));
      }
      if (commandLine.includes("lfortran") && args?.[0] === "--version") {
        if (options?.listeners?.stdout) {
          options.listeners.stdout(Buffer.from("LFortran version 0.63.0"));
        }
      }
      return 0;
    });
  });

  describe("Native (Conda)", () => {
    it("downloads and installs Miniforge", async () => {
      await installWin32(baseInputs);

      expect(mockedExec).toHaveBeenCalledWith("curl", [
        "-fsSL",
        "--retry",
        "3",
        "--retry-delay",
        "15",
        "-o",
        expect.stringContaining("miniforge-install.exe"),
        expect.stringContaining("Miniforge3-26.3.2-2-Windows-x86_64.exe"),
      ]);
      expect(mockedExec).toHaveBeenCalledWith(
        expect.stringContaining("miniforge-install.exe"),
        ["/S", expect.stringContaining("/D=")],
      );
    });

    it("installs lfortran via conda", async () => {
      await installWin32(baseInputs);

      expect(mockedExec).toHaveBeenCalledWith(
        expect.stringContaining("conda.exe"),
        expect.arrayContaining([
          "create",
          "-y",
          "-p",
          expect.stringContaining("0.63.0"),
          "lfortran==0.63.0",
        ]),
      );
    });

    it("reuses a valid environment on a second invocation", async () => {
      await installWin32(baseInputs);
      await installWin32(baseInputs);

      expect(
        mockedExec.mock.calls.filter(([command]) => command === "curl"),
      ).toHaveLength(1);
      expect(mockedFs.renameSync).not.toHaveBeenCalled();
    });

    it("exports environment variables and sets linker", async () => {
      const result = await installWin32(baseInputs);

      expect(core.addPath).toHaveBeenCalledWith(
        expect.stringContaining("lfortran"),
      );
      expect(mockedExportVariable).toHaveBeenCalledWith(
        "LFORTRAN_LINKER",
        expect.stringContaining("link.exe"),
      );
      expect(result.cc).toBe("clang");
      expect(result.cxx).toBe("clang++");
    });
  });

  describe("MSYS2", () => {
    it("calls setupMSYS2 and exports variables", async () => {
      const inputs = { ...baseInputs, msystem: Msystem.UCRT64, version: "latest" };
      await installWin32(inputs);

      expect(mockedSetupMSYS2).toHaveBeenCalledWith(Msystem.UCRT64, [
        "lfortran",
      ]);
    });

    it("reuses a working MSYS2 installation on a second invocation", async () => {
      const inputs = { ...baseInputs, msystem: Msystem.UCRT64, version: "latest" };
      await installWin32(inputs);
      await installWin32(inputs);

      expect(mockedSetupMSYS2).toHaveBeenCalledTimes(1);
    });
  });
});
