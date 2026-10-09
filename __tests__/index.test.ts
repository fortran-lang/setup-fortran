import * as core from "@actions/core";
import type { Inputs, InstallationResult } from "../src/types";
import { Arch, Compiler, Msystem, OS } from "../src/types";

jest.mock("@actions/core");
jest.mock("../src/parse_inputs", () => ({ parseInputs: jest.fn() }));
jest.mock("../src/installers/gfortran", () => ({
  installGFortran: jest.fn(),
}));
jest.mock("../src/installers/ifx", () => ({ installIFX: jest.fn() }));
jest.mock("../src/installers/ifort", () => ({ installIFort: jest.fn() }));
jest.mock("../src/installers/nvfortran", () => ({
  installNVFortran: jest.fn(),
}));
jest.mock("../src/installers/aocc", () => ({ installAOCC: jest.fn() }));
jest.mock("../src/installers/flang", () => ({ installFlang: jest.fn() }));
jest.mock("../src/installers/lfortran", () => ({
  installLFortran: jest.fn(),
}));
jest.mock("../src/installers/armflang", () => ({
  installArmFlang: jest.fn(),
}));
jest.mock("../src/installation_result", () => ({
  setInstallationOutputs: jest.fn(),
  exportInstallationVariables: jest.fn(),
}));

describe("action invocation", () => {
  const previousSmokeTest = process.env.SETUP_FORTRAN_BUNDLE_SMOKE_TEST;

  beforeAll(() => {
    process.env.SETUP_FORTRAN_BUNDLE_SMOKE_TEST = "1";
  });

  afterAll(() => {
    if (previousSmokeTest === undefined) {
      delete process.env.SETUP_FORTRAN_BUNDLE_SMOKE_TEST;
    } else {
      process.env.SETUP_FORTRAN_BUNDLE_SMOKE_TEST = previousSmokeTest;
    }
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it.each([
    [Compiler.GFortran, "../src/installers/gfortran", "installGFortran"],
    [Compiler.IFX, "../src/installers/ifx", "installIFX"],
    [Compiler.IFort, "../src/installers/ifort", "installIFort"],
    [Compiler.NVFortran, "../src/installers/nvfortran", "installNVFortran"],
  ] as const)(
    "dispatches normalized %s inputs to %s",
    async (compiler, installerModule, installerName) => {
      const { parseInputs } = jest.requireMock("../src/parse_inputs") as {
        parseInputs: jest.Mock<Inputs>;
      };
      const installer = (
        jest.requireMock(installerModule) as Record<
          string,
          jest.Mock<Promise<InstallationResult>>
        >
      )[installerName];
      const inputs: Inputs = {
        compiler,
        version: "latest",
        os: OS.Linux,
        osVersion: "24.04",
        arch: Arch.X64,
        msystem: Msystem.Native,
        cleanupDisk: false,
        updateEnvironment: true,
      };
      const result: InstallationResult = {
        version: "1.2.3",
        fc: "fc",
        cc: "cc",
        cxx: "cxx",
      };
      parseInputs.mockReturnValue(inputs);
      installer.mockResolvedValue(result);

      const { run } = await import("../src/index");
      await run();

      expect(installer).toHaveBeenCalledTimes(1);
      expect(installer).toHaveBeenCalledWith(inputs);
      expect(core.setFailed).not.toHaveBeenCalled();
    },
  );

  it("can run twice in one process without retaining invocation state", async () => {
    const { parseInputs } = jest.requireMock("../src/parse_inputs") as {
      parseInputs: jest.Mock<Inputs>;
    };
    const { installGFortran } = jest.requireMock(
      "../src/installers/gfortran",
    ) as { installGFortran: jest.Mock<Promise<InstallationResult>> };
    const { setInstallationOutputs, exportInstallationVariables } =
      jest.requireMock("../src/installation_result") as {
        setInstallationOutputs: jest.Mock;
        exportInstallationVariables: jest.Mock;
      };
    const inputs: Inputs = {
      compiler: Compiler.GFortran,
      version: "14",
      os: OS.Linux,
      osVersion: "24.04",
      arch: Arch.X64,
      msystem: Msystem.Native,
      cleanupDisk: false,
      updateEnvironment: true,
    };
    const result: InstallationResult = {
      version: "14.2.0",
      fc: "gfortran-14",
      cc: "gcc-14",
      cxx: "g++-14",
    };
    parseInputs.mockReturnValue(inputs);
    installGFortran.mockResolvedValue(result);

    const { run } = await import("../src/index");
    await run();
    await run();

    expect(parseInputs).toHaveBeenCalledTimes(2);
    expect(installGFortran).toHaveBeenCalledTimes(2);
    expect(setInstallationOutputs).toHaveBeenNthCalledWith(1, result);
    expect(setInstallationOutputs).toHaveBeenNthCalledWith(2, result);
    expect(exportInstallationVariables).toHaveBeenCalledTimes(2);
    expect(core.exportVariable).toHaveBeenCalledWith(
      "FORTRAN_COMPILER",
      Compiler.GFortran,
    );
  });

  it("always sets outputs even when update-environment is false", async () => {
    const { parseInputs } = jest.requireMock("../src/parse_inputs") as {
      parseInputs: jest.Mock<Inputs>;
    };
    const { installGFortran } = jest.requireMock(
      "../src/installers/gfortran",
    ) as { installGFortran: jest.Mock<Promise<InstallationResult>> };
    const { setInstallationOutputs, exportInstallationVariables } =
      jest.requireMock("../src/installation_result") as {
        setInstallationOutputs: jest.Mock;
        exportInstallationVariables: jest.Mock;
      };
    const inputs: Inputs = {
      compiler: Compiler.GFortran,
      version: "14",
      os: OS.Linux,
      osVersion: "24.04",
      arch: Arch.X64,
      msystem: Msystem.Native,
      cleanupDisk: false,
      updateEnvironment: false,
    };
    const result: InstallationResult = {
      version: "14.2.0",
      fc: "gfortran-14",
      cc: "gcc-14",
      cxx: "g++-14",
    };
    parseInputs.mockReturnValue(inputs);
    installGFortran.mockResolvedValue(result);

    const { run } = await import("../src/index");
    await run();

    expect(installGFortran).toHaveBeenCalledWith(inputs);
    expect(setInstallationOutputs).toHaveBeenCalledWith(result);
    expect(exportInstallationVariables).not.toHaveBeenCalled();
    expect(core.exportVariable).not.toHaveBeenCalled();
  });

  // --- Negative: no silent fallback when installers fail ---
  it("does not silently fall back to ifort when ifx fails on macOS", async () => {
    const { parseInputs } = jest.requireMock("../src/parse_inputs") as {
      parseInputs: jest.Mock<Inputs>;
    };
    const { installIFX } = jest.requireMock("../src/installers/ifx") as {
      installIFX: jest.Mock<Promise<InstallationResult>>;
    };
    const { installIFort } = jest.requireMock("../src/installers/ifort") as {
      installIFort: jest.Mock<Promise<InstallationResult>>;
    };
    const { setInstallationOutputs, exportInstallationVariables } =
      jest.requireMock("../src/installation_result") as {
        setInstallationOutputs: jest.Mock;
        exportInstallationVariables: jest.Mock;
      };

    const inputs: Inputs = {
      compiler: Compiler.IFX,
      version: "latest",
      os: OS.MacOS,
      osVersion: "14",
      arch: Arch.X64,
      msystem: Msystem.Native,
      cleanupDisk: false,
      updateEnvironment: true,
    };
    parseInputs.mockReturnValue(inputs);
    installIFX.mockRejectedValue(
      new Error(
        "ifx is not supported on macOS. Use ifort, or exclude {compiler: ifx, os: macos} from your build matrix.",
      ),
    );

    const { run } = await import("../src/index");
    await run();

    expect(installIFX).toHaveBeenCalledTimes(1);
    expect(installIFX).toHaveBeenCalledWith(inputs);
    expect(installIFort).not.toHaveBeenCalled();
    expect(core.setFailed).toHaveBeenCalledTimes(1);
    expect(setInstallationOutputs).not.toHaveBeenCalled();
    expect(exportInstallationVariables).not.toHaveBeenCalled();
    expect(core.exportVariable).not.toHaveBeenCalledWith(
      "FORTRAN_COMPILER",
      expect.anything(),
    );
    expect(core.setOutput).not.toHaveBeenCalled();
  });

  // Each failure leaves NO substituted compiler output — no silent fallback
  // to another compiler, no env exports, no action outputs.
  it.each([
    [Compiler.IFX, OS.MacOS, "ifx is not supported on macOS"],
    [Compiler.NVFortran, OS.MacOS, "nvfortran is only supported on Linux"],
    [Compiler.AOCC, OS.MacOS, "aocc is only supported on Linux"],
    [Compiler.ArmFlang, OS.MacOS, "armflang is only supported on Linux"],
  ])(
    "%s on %s leaves no substituted compiler output",
    async (compiler, os, expectedMessage) => {
      const { parseInputs } = jest.requireMock("../src/parse_inputs") as {
        parseInputs: jest.Mock<Inputs>;
      };
      const installerNameMap: Record<string, string> = {
        [Compiler.IFX]: "installIFX",
        [Compiler.NVFortran]: "installNVFortran",
        [Compiler.AOCC]: "installAOCC",
        [Compiler.ArmFlang]: "installArmFlang",
      };
      const installerModuleMap: Record<string, string> = {
        [Compiler.IFX]: "../src/installers/ifx",
        [Compiler.NVFortran]: "../src/installers/nvfortran",
        [Compiler.AOCC]: "../src/installers/aocc",
        [Compiler.ArmFlang]: "../src/installers/armflang",
      };
      const installer = (
        jest.requireMock(installerModuleMap[compiler]) as Record<
          string,
          jest.Mock<Promise<InstallationResult>>
        >
      )[installerNameMap[compiler]];
      const { setInstallationOutputs, exportInstallationVariables } =
        jest.requireMock("../src/installation_result") as {
          setInstallationOutputs: jest.Mock;
          exportInstallationVariables: jest.Mock;
        };

      const inputs: Inputs = {
        compiler,
        version: "latest",
        os,
        osVersion: os === OS.MacOS ? "14" : "24.04",
        arch: Arch.X64,
        msystem: Msystem.Native,
        cleanupDisk: false,
        updateEnvironment: true,
      };
      parseInputs.mockReturnValue(inputs);
      installer.mockRejectedValue(new Error(expectedMessage));

      const { run } = await import("../src/index");
      await run();

      expect(installer).toHaveBeenCalledTimes(1);
      expect(installer).toHaveBeenCalledWith(inputs);
      expect(core.setFailed).toHaveBeenCalledTimes(1);
      expect(core.setFailed).toHaveBeenCalledWith(
        expect.stringContaining(expectedMessage),
      );
      expect(setInstallationOutputs).not.toHaveBeenCalled();
      expect(exportInstallationVariables).not.toHaveBeenCalled();
      expect(core.setOutput).not.toHaveBeenCalled();
      expect(core.exportVariable).not.toHaveBeenCalled();
    },
  );
});
