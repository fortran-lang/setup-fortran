import * as core from "@actions/core";
import * as fs from "fs";
import {
  addMsvcBinFromPath,
  persistMsvcBinForBash,
  toMsysPath,
} from "../src/setup_msvc";

jest.mock("@actions/core");
jest.mock("fs");

describe("addMsvcBinFromPath", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.RUNNER_TEMP = "D:\\a\\_temp";
    delete process.env.BASH_ENV;
  });

  afterAll(() => {
    delete process.env.RUNNER_TEMP;
    delete process.env.BASH_ENV;
  });

  it("persists the MSVC executable directory", () => {
    const msvcBin =
      "C:\\Program Files\\Microsoft Visual Studio\\2022\\Enterprise\\VC\\Tools\\MSVC\\14.44.35207\\bin\\HostX64\\x64";

    expect(addMsvcBinFromPath(`C:\\tools;${msvcBin};C:\\Windows`)).toBe(
      msvcBin,
    );
    expect(core.addPath).toHaveBeenCalledWith(msvcBin);
    expect(core.exportVariable).toHaveBeenCalledWith(
      "BASH_ENV",
      "/d/a/_temp/setup-fortran-msvc-bash-env.sh",
    );
  });

  it("warns when the MSVC executable directory is absent", () => {
    expect(addMsvcBinFromPath("C:\\tools;C:\\Windows")).toBeUndefined();
    expect(core.addPath).not.toHaveBeenCalled();
    expect(core.warning).toHaveBeenCalledWith(
      "Could not find the MSVC executable directory in PATH.",
    );
  });

  it("prepends the MSVC directory for subsequent Bash steps", () => {
    const msvcBin =
      "C:\\Program Files\\Microsoft Visual Studio\\18\\Enterprise\\VC\\Tools\\MSVC\\14.51.36231\\bin\\HostX64\\x64";

    expect(persistMsvcBinForBash(msvcBin)).toBe(
      "D:\\a\\_temp/setup-fortran-msvc-bash-env.sh",
    );
    expect(fs.writeFileSync).toHaveBeenCalledWith(
      "D:\\a\\_temp/setup-fortran-msvc-bash-env.sh",
      `export PATH='/c/Program Files/Microsoft Visual Studio/18/Enterprise/VC/Tools/MSVC/14.51.36231/bin/HostX64/x64':"$PATH"\n`,
      { mode: 0o600 },
    );
  });

  it("preserves an existing Bash environment file", () => {
    process.env.BASH_ENV = "D:\\a\\existing env.sh";

    persistMsvcBinForBash("C:\\MSVC\\bin");

    expect(fs.writeFileSync).toHaveBeenCalledWith(
      expect.any(String),
      `. '/d/a/existing env.sh'\nexport PATH='/c/MSVC/bin':"$PATH"\n`,
      { mode: 0o600 },
    );
  });

  it("does not source itself when setup runs more than once", () => {
    process.env.BASH_ENV = "/d/a/_temp/setup-fortran-msvc-bash-env.sh";

    persistMsvcBinForBash("C:\\MSVC\\bin");

    expect(fs.writeFileSync).toHaveBeenCalledWith(
      expect.any(String),
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
