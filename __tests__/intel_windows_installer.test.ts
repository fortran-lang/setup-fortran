import * as core from "@actions/core";
import * as exec from "@actions/exec";
import { fortranComponentArgs } from "../src/intel_windows_installer";

jest.mock("@actions/core");
jest.mock("@actions/exec");

describe("fortranComponentArgs", () => {
  const mockedExec = exec.exec as jest.MockedFunction<typeof exec.exec>;

  const HPC_KIT_URL =
    "https://registrationcenter-download.intel.com/akdlm/IRC_NAS/c95a3b26-fc45-496c-833b-df08b10297b9/w_HPCKit_p_2024.1.0.561_offline.exe";
  const FORTRAN_ONLY_URL =
    "https://registrationcenter-download.intel.com/akdlm/IRC_NAS/ea23d696-a77f-4a4a-8996-20d02cdbc48f/w_fortran-compiler_p_2024.2.1.81_offline.exe";

  const mockComponentList = (output: string) => {
    mockedExec.mockImplementation(async (_commandLine, args, options) => {
      if (args?.includes("--list-components") && options?.listeners?.stdout) {
        options.listeners.stdout(Buffer.from(output));
      }
      return 0;
    });
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("restricts an HPC kit to its Fortran component", async () => {
    // The real installer prints CRLF-separated rows.
    mockComponentList(
      [
        "intel.oneapi.win.mkl.devel  2024.1.0  Intel oneAPI Math Kernel Library",
        "intel.oneapi.win.ifort-compiler  2024.1.0  Intel(R) Fortran Compiler",
        "intel.oneapi.win.tbb.devel  2024.1.0  Intel oneAPI Threading Building Blocks",
      ].join("\r\n"),
    );

    await expect(
      fortranComponentArgs("installer.exe", "2024.1.0", HPC_KIT_URL),
    ).resolves.toEqual(["--components=intel.oneapi.win.ifort-compiler"]);
  });

  it("falls back to the full kit when the Fortran component is not listed", async () => {
    mockComponentList(
      "intel.oneapi.win.mkl.devel  2024.1.0  Intel oneAPI Math Kernel Library",
    );

    await expect(
      fortranComponentArgs("installer.exe", "2024.1.0", HPC_KIT_URL),
    ).resolves.toEqual([]);
    expect(core.info).toHaveBeenCalledWith(
      expect.stringContaining("installing the full kit instead"),
    );
  });

  it("does not probe an HPC kit too old for --components", async () => {
    await expect(
      fortranComponentArgs("installer.exe", "2023.1.0", HPC_KIT_URL),
    ).resolves.toEqual([]);
    expect(mockedExec).not.toHaveBeenCalled();
  });

  it("does not probe a Fortran-only package", async () => {
    await expect(
      fortranComponentArgs("installer.exe", "2024.2.1", FORTRAN_ONLY_URL),
    ).resolves.toEqual([]);
    expect(mockedExec).not.toHaveBeenCalled();
  });
});
