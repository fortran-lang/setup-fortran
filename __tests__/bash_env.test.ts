import * as core from "@actions/core";
import * as fs from "fs";
import { persistBinDirForBash, toMsysPath } from "../src/bash_env";

jest.mock("@actions/core");
jest.mock("fs");

describe("persistBinDirForBash", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.RUNNER_TEMP = "D:\\a\\_temp";
    delete process.env.BASH_ENV;
  });

  afterAll(() => {
    delete process.env.RUNNER_TEMP;
    delete process.env.BASH_ENV;
  });

  it("writes a per-installer Bash environment and exports BASH_ENV", () => {
    const bashEnv = persistBinDirForBash(
      "C:\\hostedtoolcache\\setup-fortran\\lfortran\\win32\\x64\\0.64.0\\env\\Library\\bin",
      "lfortran",
    );

    expect(bashEnv).toBe("D:\\a\\_temp/setup-fortran-lfortran-bash-env.sh");
    expect(fs.writeFileSync).toHaveBeenCalledWith(
      "D:\\a\\_temp/setup-fortran-lfortran-bash-env.sh",
      `export PATH='/c/hostedtoolcache/setup-fortran/lfortran/win32/x64/0.64.0/env/Library/bin':"$PATH"\n`,
      { mode: 0o600 },
    );
    expect(core.exportVariable).toHaveBeenCalledWith(
      "BASH_ENV",
      "/d/a/_temp/setup-fortran-lfortran-bash-env.sh",
    );
  });

  it("chains a Bash environment written by another installer", () => {
    process.env.BASH_ENV = "D:\\a\\_temp\\setup-fortran-msvc-bash-env.sh";

    persistBinDirForBash("C:\\MSVC\\bin", "lfortran");

    expect(fs.writeFileSync).toHaveBeenCalledWith(
      expect.any(String),
      `. '/d/a/_temp/setup-fortran-msvc-bash-env.sh'\nexport PATH='/c/MSVC/bin':"$PATH"\n`,
      { mode: 0o600 },
    );
  });

  it("does not source itself when the same installer runs twice", () => {
    process.env.BASH_ENV = "/d/a/_temp/setup-fortran-lfortran-bash-env.sh";

    persistBinDirForBash("C:\\MSVC\\bin", "lfortran");

    expect(fs.writeFileSync).toHaveBeenCalledWith(
      "D:\\a\\_temp/setup-fortran-lfortran-bash-env.sh",
      `export PATH='/c/MSVC/bin':"$PATH"\n`,
      { mode: 0o600 },
    );
  });
});

describe("toMsysPath", () => {
  it("converts Windows drive paths for Git Bash", () => {
    expect(toMsysPath("C:\\Program Files\\LLVM\\bin")).toBe(
      "/c/Program Files/LLVM/bin",
    );
  });
});
