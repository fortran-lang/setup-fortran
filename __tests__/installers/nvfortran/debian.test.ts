import * as core from "@actions/core";
import * as exec from "@actions/exec";
import * as cache from "@actions/cache";
import { installDebian } from "../../../src/installers/nvfortran/debian";
import {
  Arch,
  Compiler,
  OS,
  Msystem,
  type Inputs,
} from "../../../src/types";

jest.mock("@actions/core");
jest.mock("@actions/exec");
jest.mock("@actions/cache");
jest.mock("../../../src/verify_download");

describe("installDebian nvfortran", () => {
  const mockedExec = exec.exec as jest.MockedFunction<typeof exec.exec>;
  const mockedGetExecOutput = exec.getExecOutput as jest.MockedFunction<
    typeof exec.getExecOutput
  >;
  const mockedCache = cache as jest.Mocked<typeof cache>;
  const mockedExportVariable = core.exportVariable as jest.MockedFunction<
    typeof core.exportVariable
  >;

  const baseInputs: Inputs = {
    compiler: Compiler.NVFortran,
    version: "24.1",
    os: OS.Linux,
    osVersion: "22.04",
    arch: Arch.X64,
  cleanupDisk: false,
    updateEnvironment: true,
    msystem: Msystem.Native,
  };

  beforeEach(() => {
    jest.clearAllMocks();
    mockedCache.restoreCache.mockResolvedValue(undefined);
    mockedExec.mockImplementation(async (commandLine, args, options) => {
      if (commandLine === "nvfortran" && args?.[0] === "--version") {
        options?.listeners?.stdout?.(Buffer.from("nvfortran 24.1-0"));
      }
      return 0;
    });
    (exec.getExecOutput as jest.Mock).mockResolvedValue({
      stdout: "install ok installed install ok installed",
      exitCode: 0,
    });
  });

  it("installs legacy ncurses via direct download when needed", async () => {
    // Version <= 24.3 triggers ncurses check
    const inputs = { ...baseInputs, version: "24.3" };

    // Simulate ncurses not installed
    (exec.getExecOutput as jest.Mock).mockResolvedValue({
      stdout: "",
      exitCode: 0,
    });

    mockedExec.mockImplementation(async (commandLine, args, options) => {
      if (commandLine === "nvfortran" && args?.[0] === "--version") {
        options?.listeners?.stdout?.(Buffer.from("nvfortran 24.1-0"));
      }
      return 0;
    });

    await installDebian(inputs);

    // Should download each pinned .deb from the Ubuntu archive pool
    expect(mockedExec).toHaveBeenCalledWith(
      "curl",
      expect.arrayContaining([
        "https://security.ubuntu.com/ubuntu/pool/universe/n/ncurses/libtinfo5_6.3-2_amd64.deb",
      ]),
    );
    expect(mockedExec).toHaveBeenCalledWith(
      "curl",
      expect.arrayContaining([
        "https://security.ubuntu.com/ubuntu/pool/universe/n/ncurses/libncursesw5_6.3-2_amd64.deb",
      ]),
    );
    // Should install each .deb via dpkg
    expect(mockedExec).toHaveBeenCalledWith(
      "sudo",
      expect.arrayContaining(["dpkg", "-i", expect.stringContaining("libtinfo5")]),
    );
    expect(mockedExec).toHaveBeenCalledWith(
      "sudo",
      expect.arrayContaining(["dpkg", "-i", expect.stringContaining("libncursesw5")]),
    );
  });

  it("downloads the arm64 ncurses debs from ports.ubuntu.com", async () => {
    const inputs = {
      ...baseInputs,
      version: "24.3",
      arch: Arch.ARM64,
    };

    // Simulate ncurses not installed
    (exec.getExecOutput as jest.Mock).mockResolvedValue({
      stdout: "",
      exitCode: 0,
    });

    await installDebian(inputs);

    expect(mockedExec).toHaveBeenCalledWith(
      "curl",
      expect.arrayContaining([
        "https://ports.ubuntu.com/ubuntu-ports/pool/universe/n/ncurses/libtinfo5_6.3-2_arm64.deb",
      ]),
    );
    expect(mockedExec).toHaveBeenCalledWith(
      "curl",
      expect.arrayContaining([
        "https://ports.ubuntu.com/ubuntu-ports/pool/universe/n/ncurses/libncursesw5_6.3-2_arm64.deb",
      ]),
    );
  });

  it("skips ncurses install if already present", async () => {
    const inputs = { ...baseInputs, version: "24.3" };

    // Already installed
    (exec.getExecOutput as jest.Mock).mockResolvedValue({
      stdout: "install ok installed install ok installed",
      exitCode: 0,
    });

    await installDebian(inputs);

    // Should not download any .deb
    expect(mockedExec).not.toHaveBeenCalledWith(
      "curl",
      expect.arrayContaining(["-o"]),
      expect.anything(),
    );
  });

  it("skips ncurses install for newer nvhpc versions", async () => {
    // Version > 24.3
    const inputs = { ...baseInputs, version: "25.1" };

    await installDebian(inputs);

    // Should not download any .deb
    expect(mockedExec).not.toHaveBeenCalledWith(
      "curl",
      expect.arrayContaining(["-o"]),
      expect.anything(),
    );
  });

  it("exports compiler variables and returns the installation result", async () => {
    const result = await installDebian(baseInputs);

    expect(result).toEqual({
      version: "nvfortran 24.1-0",
      fc: "nvfortran",
      cc: "nvc",
      cxx: "nvc++",
    });
  });

  it("does not write global APT settings or rewrite Ubuntu mirrors", async () => {
    await installDebian(baseInputs);

    expect(mockedExec).not.toHaveBeenCalledWith(
      "sudo",
      expect.arrayContaining([
        expect.stringMatching(/apt\.conf\.d|sources\.list|ubuntu\.sources/),
      ]),
    );
  });

  it("falls back to the versioned tarball after one apt install failure", async () => {
    const inputs = { ...baseInputs, version: "26.3" };
    mockedGetExecOutput.mockImplementation(async (command, args) => ({
      stdout:
        command === "dpkg-query"
          ? "install ok installed install ok installed"
          : "",
      stderr: "",
      exitCode:
        command === "curl" &&
        args?.some((arg) => arg.includes("_cuda_13.1.tar.gz"))
          ? 0
          : command === "dpkg-query"
            ? 0
            : 22,
    }));
    mockedExec.mockImplementation(async (commandLine, args, options) => {
      if (commandLine === "nvfortran" && args?.[0] === "--version") {
        options?.listeners?.stdout?.(Buffer.from("nvfortran 26.3-0"));
      }
      if (
        commandLine === "sudo" &&
        args?.includes("apt-get") &&
        args.includes("nvhpc-26-3")
      ) {
        throw new Error("404 Not Found");
      }
      return 0;
    });

    await installDebian(inputs);

    expect(
      mockedExec.mock.calls.filter(
        ([command, args]) =>
          command === "sudo" &&
          args?.includes("apt-get") &&
          args.includes("nvhpc-26-3"),
      ),
    ).toHaveLength(1);
    expect(mockedExec).toHaveBeenCalledWith(
      "curl",
      expect.arrayContaining([
        "-o",
        expect.stringContaining(
          "nvhpc_2026_263_Linux_x86_64_cuda_13.1.tar.gz",
        ),
        "https://developer.download.nvidia.com/hpc-sdk/26.3/nvhpc_2026_263_Linux_x86_64_cuda_13.1.tar.gz",
      ]),
    );
    expect(mockedExec).toHaveBeenCalledWith(
      "sudo",
      expect.arrayContaining([
        "env",
        "NVHPC_SILENT=true",
        "NVHPC_INSTALL_DIR=/opt/nvidia/hpc_sdk",
        "NVHPC_INSTALL_TYPE=single",
        expect.stringContaining(
          "nvhpc_2026_263_Linux_x86_64_cuda_13.1/install",
        ),
      ]),
    );
  });

  it("uses the CUDA 11.0 Arm tarball directly for version 20.9", async () => {
    const inputs = {
      ...baseInputs,
      version: "20.9",
      arch: Arch.ARM64,
    };

    await installDebian(inputs);

    expect(mockedExec).not.toHaveBeenCalledWith(
      "bash",
      expect.arrayContaining([
        "-c",
        expect.stringContaining("nvidia-hpcsdk-archive-keyring"),
      ]),
    );
    expect(mockedExec).toHaveBeenCalledWith(
      "curl",
      expect.arrayContaining([
        "-o",
        expect.stringContaining(
          "nvhpc_2020_209_Linux_aarch64_cuda_11.0.tar.gz",
        ),
        "https://developer.download.nvidia.com/hpc-sdk/20.9/nvhpc_2020_209_Linux_aarch64_cuda_11.0.tar.gz",
      ]),
    );
  });
});
