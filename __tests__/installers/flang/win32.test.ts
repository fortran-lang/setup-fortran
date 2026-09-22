import * as core from "@actions/core";
import * as exec from "@actions/exec";
import * as tc from "@actions/tool-cache";
import * as fs from "fs";
import { installWin32 } from "../../../src/installers/flang/win32";
import { setupMSYS2 } from "../../../src/setup_msys2";
import { Arch, Compiler, OS, Msystem, type Inputs } from "../../../src/types";

jest.mock("@actions/core");
jest.mock("@actions/exec");
jest.mock("@actions/tool-cache");
jest.mock("../../../src/setup_msys2");
jest.mock("../../../src/verify_download");
jest.mock("fs", () => ({
  ...jest.requireActual("fs"),
  existsSync: jest.fn(),
  mkdirSync: jest.fn(),
  readdirSync: jest.fn(),
}));

describe("installWin32 (Flang)", () => {
  beforeAll(() => {
    global.fetch = jest.fn().mockImplementation(async (input: string | URL) => {
      const url = String(input);
      if (url.includes("/releases?")) {
        // Paginated list: only page 1 carries data; later pages are empty
        // so asset-aware resolution terminates instead of re-scanning.
        const page = new URL(url).searchParams.get("page") ?? "1";
        return {
          ok: true,
          status: 200,
          json: async () =>
            page === "1"
              ? [
                  { tag_name: "llvmorg-23.1.0", prerelease: false },
                  { tag_name: "llvmorg-22.1.0", prerelease: false },
                ]
              : [],
        };
      }
      return {
        ok: true,
        status: 200,
        json: async () =>
          url.includes("llvmorg-23.1.0")
            ? {
                assets: [
                  {
                    name: "LLVM-23.1.0-win64.msi",
                    digest: `sha256:${"a".repeat(64)}`,
                  },
                  {
                    name: "LLVM-23.1.0-woa64.msi",
                    digest: `sha256:${"a".repeat(64)}`,
                  },
                ],
              }
            : {
                assets: [
                  {
                    name: "LLVM-22.1.0-win64.exe",
                    digest: `sha256:${"a".repeat(64)}`,
                  },
                  {
                    name: "LLVM-22.1.0-woa64.exe",
                    digest: `sha256:${"a".repeat(64)}`,
                  },
                ],
              },
      };
    });
  });

  afterEach(() => {
    jest.clearAllMocks();
    jest.useRealTimers();
  });

  afterAll(() => {
    jest.restoreAllMocks();
  });

  const mockedExec = exec.exec as jest.MockedFunction<typeof exec.exec>;
  const mockedTc = tc as jest.Mocked<typeof tc>;
  const mockedFs = fs as jest.Mocked<typeof fs>;
  const mockedSetupMSYS2 = setupMSYS2 as jest.MockedFunction<typeof setupMSYS2>;
  const mockedExportVariable = core.exportVariable as jest.MockedFunction<
    typeof core.exportVariable
  >;

  const baseInputs: Inputs = {
    compiler: Compiler.Flang,
    version: "22",
    os: OS.Windows,
    osVersion: "2022",
    arch: Arch.X64,
    cleanupDisk: false,
    updateEnvironment: true,
    msystem: Msystem.Native,
  };

  beforeEach(() => {
    jest.clearAllMocks();
    mockedFs.existsSync.mockReturnValue(true);
    mockedFs.readdirSync.mockReturnValue(["14.38.33130" as any]);
    mockedExec.mockImplementation(async (commandLine, args, options) => {
      if (commandLine.includes("flang") && args?.[0] === "--version") {
        if (options?.listeners?.stdout) {
          options.listeners.stdout(Buffer.from("flang version 22.0.0"));
        }
      }
      if (commandLine.includes("vswhere.exe")) {
        if (options?.listeners?.stdout) {
          options.listeners.stdout(Buffer.from("C:\\VS"));
        }
      }
      return 0;
    });
  });

  describe("Native", () => {
    it("downloads and extracts LLVM installer", async () => {
      mockedTc.find.mockReturnValue("");
      mockedTc.downloadTool.mockResolvedValue("C:\\Temp\\llvm.exe");
      mockedTc.extractZip.mockResolvedValue("C:\\Temp\\extracted");
      mockedTc.cacheDir.mockResolvedValue("C:\\Cache\\flang");

      const result = await installWin32(baseInputs);

      expect(result.fc).toEqual(expect.stringContaining("flang.exe"));
      expect(result.cc).toEqual(expect.stringContaining("clang.exe"));
      expect(result.cxx).toEqual(expect.stringContaining("clang++.exe"));
      expect(mockedTc.downloadTool).toHaveBeenCalled();
      expect(mockedExec).toHaveBeenCalledWith(
        expect.stringContaining("7z.exe"),
        expect.arrayContaining(["x", "C:\\Temp\\llvm.exe"]),
      );
      expect(mockedTc.cacheDir).toHaveBeenCalled();
    });

    it("retries a failed download and succeeds", async () => {
      mockedTc.find.mockReturnValue("");
      mockedTc.downloadTool
        .mockRejectedValueOnce(new Error("Unexpected HTTP response: 504"))
        .mockResolvedValue("C:\\Temp\\llvm.exe");
      mockedTc.extractZip.mockResolvedValue("C:\\Temp\\extracted");
      mockedTc.cacheDir.mockResolvedValue("C:\\Cache\\flang");

      jest.useFakeTimers();
      try {
        const installPromise = installWin32(baseInputs);

        for (let i = 0; i < 10; i++) await Promise.resolve();
        expect(mockedTc.downloadTool).toHaveBeenCalledTimes(1);

        // Advance past the 20s backoff after the first failure.
        jest.advanceTimersByTime(20_000);
        for (let i = 0; i < 10; i++) await Promise.resolve();

        await installPromise;
      } finally {
        jest.useRealTimers();
      }

      expect(mockedTc.downloadTool).toHaveBeenCalledTimes(2);
      expect(core.info).toHaveBeenCalledWith(
        expect.stringContaining("Download failed (attempt 1/3)"),
      );
    });

    it("extracts the LLVM 23 MSI with an msiexec administrative install", async () => {
      const inputs = { ...baseInputs, version: "23" };
      mockedTc.find.mockReturnValue("");
      // tc.downloadTool saves to an extensionless GUID path when no
      // destination is passed — extraction must not dispatch on the extension.
      mockedTc.downloadTool.mockResolvedValue(
        "D:\\a\\_temp\\e50d54fe-ad02-446d-9587-48dee931e0c6",
      );
      mockedTc.cacheDir.mockResolvedValue("C:\\Cache\\flang23");

      const result = await installWin32(inputs);

      // The installer is downloaded under its real (extension-bearing) name.
      expect(mockedTc.downloadTool).toHaveBeenCalledWith(
        expect.stringContaining("LLVM-23.1.0-win64.msi"),
        expect.stringContaining("LLVM-23.1.0-win64.msi"),
      );
      expect(mockedExec).toHaveBeenCalledWith("msiexec", [
        "/a",
        "D:\\a\\_temp\\e50d54fe-ad02-446d-9587-48dee931e0c6",
        "/qn",
        expect.stringContaining("TARGETDIR="),
      ]);
      // The WiX layout nests the install tree under a single LLVM directory,
      // which is what gets cached so bin/ sits at the tool cache root.
      expect(mockedTc.cacheDir).toHaveBeenCalledWith(
        expect.stringMatching(/LLVM$/),
        "flang-verified",
        "23.1.0",
        Arch.X64,
      );
      expect(result.fc).toEqual(expect.stringContaining("flang.exe"));
    });

    it("fails loudly when the msiexec extraction misses the bin directory", async () => {
      const inputs = { ...baseInputs, version: "23" };
      mockedTc.find.mockReturnValue("");
      mockedTc.downloadTool.mockResolvedValue("C:\\Temp\\llvm.msi");
      mockedFs.existsSync.mockImplementation(
        (p) => !/LLVM[/\\]bin$/.test(String(p)),
      );

      await expect(installWin32(inputs)).rejects.toThrow(/expected layout/);
      expect(mockedTc.cacheDir).not.toHaveBeenCalled();
    });

    it("sets up MSVC libs and exports variables", async () => {
      mockedTc.find.mockReturnValue("C:\\Cache\\flang");

      await installWin32(baseInputs);

      expect(mockedExportVariable).toHaveBeenCalledWith(
        "LIB",
        expect.stringContaining("Cache"),
      );
    });

    it("resolves the woa64 asset suffix and Arch.ARM64 tool-cache key on Windows on Arm", async () => {
      const inputs = { ...baseInputs, arch: Arch.ARM64, version: "22" };
      mockedTc.find.mockReturnValue("");
      mockedTc.downloadTool.mockResolvedValue("C:\\Temp\\llvm-woa64.exe");
      mockedTc.cacheDir.mockResolvedValue("C:\\Cache\\flang-arm64");

      const result = await installWin32(inputs);

      expect(mockedTc.downloadTool).toHaveBeenCalledWith(
        expect.stringContaining("LLVM-22.1.0-woa64.exe"),
        expect.stringContaining("LLVM-22.1.0-woa64.exe"),
      );
      expect(mockedTc.cacheDir).toHaveBeenCalledWith(
        expect.any(String),
        "flang-verified",
        "22.1.0",
        Arch.ARM64,
      );
      expect(result.fc).toEqual(expect.stringContaining("flang.exe"));
    });

    it("falls back to an older patch when the newest lacks the woa64 asset", async () => {
      // Regression test: llvmorg-23.1.2 ships win64.msi but no woa64.msi,
      // while 23.1.1 ships both. A bare "23" on ARM64 must resolve to 23.1.1.
      const inputs = { ...baseInputs, arch: Arch.ARM64, version: "23" };
      const fetchMock = global.fetch as jest.Mock;
      const originalImpl = fetchMock.getMockImplementation();
      const digest = `sha256:${"b".repeat(64)}`;
      fetchMock.mockImplementation(async (input: string | URL) => {
        const url = String(input);
        if (url.includes("/releases?")) {
          return {
            ok: true,
            status: 200,
            json: async () => [
              {
                tag_name: "llvmorg-23.1.2",
                prerelease: false,
                assets: [{ name: "LLVM-23.1.2-win64.msi" }],
              },
              {
                tag_name: "llvmorg-23.1.1",
                prerelease: false,
                assets: [
                  { name: "LLVM-23.1.1-win64.msi" },
                  { name: "LLVM-23.1.1-woa64.msi" },
                ],
              },
            ],
          };
        }
        if (url.includes("llvmorg-23.1.1")) {
          return {
            ok: true,
            status: 200,
            json: async () => ({
              assets: [
                { name: "LLVM-23.1.1-win64.msi", digest },
                { name: "LLVM-23.1.1-woa64.msi", digest },
              ],
            }),
          };
        }
        return {
          ok: true,
          status: 200,
          json: async () => ({
            assets: [{ name: "LLVM-23.1.2-win64.msi", digest }],
          }),
        };
      });

      try {
        mockedTc.find.mockReturnValue("");
        mockedTc.downloadTool.mockResolvedValue("C:\\Temp\\llvm-woa64.msi");
        mockedTc.cacheDir.mockResolvedValue("C:\\Cache\\flang-arm64");

        const result = await installWin32(inputs);

        expect(mockedTc.downloadTool).toHaveBeenCalledWith(
          expect.stringContaining("LLVM-23.1.1-woa64.msi"),
          expect.stringContaining("LLVM-23.1.1-woa64.msi"),
        );
        expect(mockedTc.cacheDir).toHaveBeenCalledWith(
          expect.any(String),
          "flang-verified",
          "23.1.1",
          Arch.ARM64,
        );
        expect(result.fc).toEqual(expect.stringContaining("flang.exe"));
      } finally {
        fetchMock.mockImplementation(originalImpl);
      }
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

      // llvm-openmp is required for -fopenmp; the flang package only lists it
      // as an optional dependency.
      expect(mockedSetupMSYS2).toHaveBeenCalledWith(Msystem.UCRT64, [
        "flang",
        "llvm-openmp",
      ]);
    });

    it("calls setupMSYS2 with Clang64 and exports variables", async () => {
      const inputs = {
        ...baseInputs,
        version: "latest",
        msystem: Msystem.Clang64,
      };
      await installWin32(inputs);

      expect(mockedSetupMSYS2).toHaveBeenCalledWith(Msystem.Clang64, [
        "flang",
        "llvm-openmp",
      ]);
      expect(core.exportVariable).toHaveBeenCalledWith(
        "WINDOWS_ENV",
        Msystem.Clang64,
      );
    });
  });
});
