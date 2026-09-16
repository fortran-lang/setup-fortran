import * as core from "@actions/core";
import * as fs from "fs";
import * as path from "path";
import { persistBinDirForBash, toMsysPath } from "../src/bash_env";

jest.mock("@actions/core");
jest.mock("fs");

describe("persistBinDirForBash", () => {
  const runnerTemp = "D:\\a\\_temp";
  // Built the same way persistBinDirForBash builds it (plain path.join),
  // so this matches regardless of whether the test runs on Linux CI or a
  // native Windows machine: both sides track the same host OS.
  const lfortranBashEnvPath = path.join(
    runnerTemp,
    "setup-fortran-lfortran-bash-env.sh",
  );

  beforeEach(() => {
    jest.clearAllMocks();
    process.env.RUNNER_TEMP = runnerTemp;
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

    expect(bashEnv).toBe(lfortranBashEnvPath);
    expect(fs.writeFileSync).toHaveBeenCalledWith(
      lfortranBashEnvPath,
      `export PATH='/c/hostedtoolcache/setup-fortran/lfortran/win32/x64/0.64.0/env/Library/bin':"$PATH"\n`,
      { mode: 0o600 },
    );
    expect(core.exportVariable).toHaveBeenCalledWith(
      "BASH_ENV",
      toMsysPath(lfortranBashEnvPath),
    );
  });

  it("chains a Bash environment written by another installer", () => {
    const previousBashEnv = path.join(
      runnerTemp,
      "setup-fortran-msvc-bash-env.sh",
    );
    process.env.BASH_ENV = previousBashEnv;

    persistBinDirForBash("C:\\MSVC\\bin", "lfortran");

    expect(fs.writeFileSync).toHaveBeenCalledWith(
      expect.any(String),
      `. '${toMsysPath(previousBashEnv)}'\nexport PATH='/c/MSVC/bin':"$PATH"\n`,
      { mode: 0o600 },
    );
  });

  it("does not source itself when the same installer runs twice", () => {
    process.env.BASH_ENV = toMsysPath(lfortranBashEnvPath);

    persistBinDirForBash("C:\\MSVC\\bin", "lfortran");

    expect(fs.writeFileSync).toHaveBeenCalledWith(
      lfortranBashEnvPath,
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
