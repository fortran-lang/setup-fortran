import * as core from "@actions/core";
import {
  exportInstallationVariables,
  normalizeVersionOutput,
  setInstallationOutputs,
} from "../src/installation_result";
import type { InstallationResult } from "../src/types";

jest.mock("@actions/core");

describe("installation result helpers", () => {
  const result: InstallationResult = {
    version: "GNU Fortran (Ubuntu 14.2.0-1ubuntu2) 14.2.0\nCopyright GCC",
    fc: "fortran",
    cc: "c",
    cxx: "cxx",
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("sets action outputs from the installation result", () => {
    setInstallationOutputs(result);

    expect(core.setOutput).toHaveBeenCalledWith("version", "14.2.0");
    expect(core.setOutput).toHaveBeenCalledWith("fc", "fortran");
    expect(core.setOutput).toHaveBeenCalledWith("cc", "c");
    expect(core.setOutput).toHaveBeenCalledWith("cxx", "cxx");
  });

  it.each([
    ["14", "14"],
    ["ifort (IFORT) 2021.10.0 20230609", "2021.10.0"],
    ["flang-new version 19.1.7\nTarget: x86_64-linux-gnu", "19.1.7"],
    ["LFortran version: 0.64.0-12-gabcdef", "0.64.0"],
    ["AMD clang version 17.0.0 (AOCC_5.0.0-Build#123)", "5.0.0"],
  ])("normalizes compiler version output %p", (output, expected) => {
    expect(normalizeVersionOutput(output)).toBe(expected);
  });

  it("rejects a banner without a numeric version", () => {
    expect(() => normalizeVersionOutput("unknown compiler")).toThrow(
      "Could not determine compiler version",
    );
  });

  it("exports compiler, fpm, and alias variables from the installation result", () => {
    exportInstallationVariables(result);

    expect(core.exportVariable).toHaveBeenCalledWith("FC", "fortran");
    expect(core.exportVariable).toHaveBeenCalledWith("CC", "c");
    expect(core.exportVariable).toHaveBeenCalledWith("CXX", "cxx");
    expect(core.exportVariable).toHaveBeenCalledWith("FPM_FC", "fortran");
    expect(core.exportVariable).toHaveBeenCalledWith("FPM_CC", "c");
    expect(core.exportVariable).toHaveBeenCalledWith("FPM_CXX", "cxx");
    expect(core.exportVariable).toHaveBeenCalledWith("F77", "fortran");
    expect(core.exportVariable).toHaveBeenCalledWith("F90", "fortran");
  });

  it("ensures environment variables and action outputs are in sync", () => {
    setInstallationOutputs(result);
    exportInstallationVariables(result);

    const outputs = (core.setOutput as jest.Mock).mock.calls.reduce(
      (acc: Record<string, string>, [key, val]) => {
        acc[key] = val;
        return acc;
      },
      {},
    );

    const envVars = (core.exportVariable as jest.Mock).mock.calls.reduce(
      (acc: Record<string, string>, [key, val]) => {
        acc[key] = val;
        return acc;
      },
      {},
    );

    expect(envVars["FC"]).toBe(outputs["fc"]);
    expect(envVars["CC"]).toBe(outputs["cc"]);
    expect(envVars["CXX"]).toBe(outputs["cxx"]);

    // Also check aliases
    expect(envVars["FPM_FC"]).toBe(outputs["fc"]);
    expect(envVars["F77"]).toBe(outputs["fc"]);
    expect(envVars["F90"]).toBe(outputs["fc"]);
    expect(envVars["FPM_CC"]).toBe(outputs["cc"]);
    expect(envVars["FPM_CXX"]).toBe(outputs["cxx"]);
  });
});
