import * as core from "@actions/core";
import * as exec from "@actions/exec";
import * as tc from "@actions/tool-cache";
import { installWin32 } from "../../../src/installers/gfortran/win32";
import { setupMSYS2 } from "../../../src/setup_msys2";
import { verifySha256 } from "../../../src/verify_download";
import { Arch, Compiler, OS, Msystem, type Inputs } from "../../../src/types";

jest.mock("@actions/core");
jest.mock("@actions/exec");
jest.mock("@actions/tool-cache");
jest.mock("../../../src/setup_msys2");
jest.mock("../../../src/verify_download");

describe("installWin32 (gfortran)", () => {
  const mockedExec = exec.exec as jest.MockedFunction<typeof exec.exec>;
  const mockedTc = tc as jest.Mocked<typeof tc>;
  const mockedSetupMSYS2 = setupMSYS2 as jest.MockedFunction<typeof setupMSYS2>;
  const mockedVerifySha256 = verifySha256 as jest.MockedFunction<
    typeof verifySha256
  >;
  const mockedExportVariable = core.exportVariable as jest.MockedFunction<
    typeof core.exportVariable
  >;

  const baseInputs: Inputs = {
    compiler: Compiler.GFortran,
    version: "14",
    os: OS.Windows,
    osVersion: "2022",
    arch: Arch.X64,
    cleanupDisk: false,
    updateEnvironment: true,
    msystem: Msystem.Native,
  };

  beforeEach(() => {
    jest.clearAllMocks();
    mockedVerifySha256.mockResolvedValue();
    mockedExec.mockImplementation(async (commandLine, args, options) => {
      if (commandLine === "gfortran" && args?.[0] === "-dumpversion") {
        if (options?.listeners?.stdout) {
          options.listeners.stdout(Buffer.from("14.1.0"));
        }
      }
      return 0;
    });
  });

  describe("Native", () => {
    it("downloads and extracts GFortran", async () => {
      mockedTc.find.mockReturnValue("");
      mockedTc.downloadTool.mockResolvedValue("C:\\Temp\\gcc.zip");
      mockedTc.extractZip.mockResolvedValue("C:\\Temp\\extracted");
      mockedTc.cacheDir.mockResolvedValue("C:\\Cache\\gfortran");

      const result = await installWin32(baseInputs);

      expect(result.fc).toBe("C:\\Cache\\gfortran/bin/gfortran.exe");
      expect(result.cc).toBe("C:\\Cache\\gfortran/bin/gcc.exe");
      expect(result.cxx).toBe("C:\\Cache\\gfortran/bin/g++.exe");
      expect(mockedTc.downloadTool).toHaveBeenCalled();
      expect(mockedTc.extractZip).toHaveBeenCalledWith("C:\\Temp\\gcc.zip");
      expect(mockedTc.cacheDir).toHaveBeenCalled();
      expect(core.addPath).toHaveBeenCalledWith(expect.stringContaining("bin"));
    });

    it("aborts before extraction when checksum verification fails", async () => {
      mockedTc.find.mockReturnValue("");
      mockedTc.downloadTool.mockResolvedValue("C:\\Temp\\gcc.zip");
      mockedVerifySha256.mockRejectedValue(
        new Error("SHA-256 verification failed"),
      );

      await expect(installWin32(baseInputs)).rejects.toThrow(
        "SHA-256 verification failed",
      );

      expect(mockedTc.extractZip).not.toHaveBeenCalled();
      expect(mockedTc.cacheDir).not.toHaveBeenCalled();
    });

    it("exports environment variables", async () => {
      mockedTc.find.mockReturnValue("C:\\Cache\\gfortran");

      await installWin32(baseInputs);
    });
  });

  describe("MSYS2", () => {
    it("calls setupMSYS2 and exports variables", async () => {
      const inputs = {
        ...baseInputs,
        version: "latest",
        msystem: Msystem.UCRT64,
      };
      await installWin32(inputs);

      expect(mockedSetupMSYS2).toHaveBeenCalledWith(Msystem.UCRT64, [
        "gcc-fortran",
      ]);
    });
  });
});
