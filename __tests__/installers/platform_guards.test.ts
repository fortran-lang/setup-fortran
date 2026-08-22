import { installAOCC } from "../../src/installers/aocc";
import { installArmFlang } from "../../src/installers/armflang";
import { installIFX } from "../../src/installers/ifx";
import { installIFort } from "../../src/installers/ifort";
import { installNVFortran } from "../../src/installers/nvfortran";
import * as aoccDebian from "../../src/installers/aocc/debian";
import * as armflangDebian from "../../src/installers/armflang/debian";
import * as ifxDebian from "../../src/installers/ifx/debian";
import * as ifortDebian from "../../src/installers/ifort/debian";
import * as ifortWin32 from "../../src/installers/ifort/win32";
import * as nvfortranDebian from "../../src/installers/nvfortran/debian";
import { Arch, Compiler, Msystem, OS, type Inputs } from "../../src/types";

function makeInputs(overrides: Partial<Inputs> = {}): Inputs {
  return {
    compiler: Compiler.GFortran,
    version: "latest",
    os: OS.Linux,
    osVersion: "24.04",
    arch: Arch.X64,
    msystem: Msystem.Native,
    cleanupDisk: false,
    updateEnvironment: true,
    ...overrides,
  };
}

// The platform guards are the FIRST statement of each installer's dispatch.
// Asserting the exact guard message (which can only originate there) together
// with a spy showing the platform-specific installer was never called proves
// that an unsupported compiler/OS/arch combination is rejected before any cache
// restore, download, package-repository change, or other mutation.
describe("platform guards fail fast before any mutation", () => {
  it.each([
    [Compiler.NVFortran, installNVFortran, nvfortranDebian],
    [Compiler.AOCC, installAOCC, aoccDebian],
    [Compiler.ArmFlang, installArmFlang, armflangDebian],
  ])(
    "%s on macOS is rejected before its installer runs",
    async (compiler, install, module) => {
      const spy = jest.spyOn(module, "installDebian");
      await expect(
        install(makeInputs({ compiler, os: OS.MacOS, arch: Arch.X64 })),
      ).rejects.toThrow(
        `${compiler} is only supported on Linux. Got: ${OS.MacOS}`,
      );
      expect(spy).not.toHaveBeenCalled();
      spy.mockRestore();
    },
  );

  it.each([
    [Compiler.NVFortran, installNVFortran, nvfortranDebian],
    [Compiler.AOCC, installAOCC, aoccDebian],
    [Compiler.ArmFlang, installArmFlang, armflangDebian],
  ])(
    "%s on Windows is rejected before its installer runs",
    async (compiler, install, module) => {
      const spy = jest.spyOn(module, "installDebian");
      await expect(
        install(makeInputs({ compiler, os: OS.Windows, arch: Arch.X64 })),
      ).rejects.toThrow(
        `${compiler} is only supported on Linux. Got: ${OS.Windows}`,
      );
      expect(spy).not.toHaveBeenCalled();
      spy.mockRestore();
    },
  );

  // armflang's OS guard passes on Linux; the arch guard lives in resolveVersion,
  // which is the first statement of installDebian — before any I/O.
  it("rejects armflang on Linux x64 via resolveVersion (arch-level preflight)", async () => {
    const spy = jest.spyOn(armflangDebian, "installDebian");
    await expect(
      installArmFlang(
        makeInputs({ compiler: Compiler.ArmFlang, os: OS.Linux, arch: Arch.X64 }),
      ),
    ).rejects.toThrow(
      /No supported versions found for armflang on linux \(x64\)/,
    );
    expect(spy).toHaveBeenCalledTimes(1);
    spy.mockRestore();
  });

  // --- ifx / intel alias on macOS: no silent fallback to ifort ---
  it("ifx on macOS is rejected before its installer runs", async () => {
    const spy = jest.spyOn(ifxDebian, "installDebian");
    await expect(
      installIFX(
        makeInputs({ compiler: Compiler.IFX, os: OS.MacOS, arch: Arch.X64 }),
      ),
    ).rejects.toThrow(/ifx is not supported on macOS/);
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  // --- ifort on unsupported architectures: fail via resolveVersion/resolveWindowsVersion ---
  it("ifort on Linux ARM64 is rejected via resolveVersion (arch-level preflight)", async () => {
    const spy = jest.spyOn(ifortDebian, "installDebian");
    await expect(
      installIFort(
        makeInputs({
          compiler: Compiler.IFort,
          os: OS.Linux,
          arch: Arch.ARM64,
        }),
      ),
    ).rejects.toThrow(
      /No supported versions found for ifort on linux \(arm64\)/,
    );
    expect(spy).toHaveBeenCalledTimes(1);
    spy.mockRestore();
  });

  it("ifort on Windows ARM64 is rejected via resolveWindowsVersion (arch-level preflight)", async () => {
    const spy = jest.spyOn(ifortWin32, "installWin32");
    await expect(
      installIFort(
        makeInputs({
          compiler: Compiler.IFort,
          os: OS.Windows,
          arch: Arch.ARM64,
          osVersion: "2022",
        }),
      ),
    ).rejects.toThrow(
      /not supported for Windows arm64/,
    );
    expect(spy).toHaveBeenCalledTimes(1);
    spy.mockRestore();
  });
});
