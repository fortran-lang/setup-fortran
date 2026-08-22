import * as core from "@actions/core";
import * as exec from "@actions/exec";
import {
  setupMSYS2,
  msys2PkgName,
  pacmanInstallWithRetry,
} from "../src/setup_msys2";
import { Msystem } from "../src/types";

jest.mock("@actions/core");
jest.mock("@actions/exec");

const mockedExec = exec.exec as jest.MockedFunction<typeof exec.exec>;
const mockedWarning = core.warning as jest.MockedFunction<typeof core.warning>;

const PACMAN_CMD = "C:\\msys64\\usr\\bin\\bash.exe";

function expectPacmanCall(pkgList: string): void {
  expect(mockedExec).toHaveBeenCalledWith(PACMAN_CMD, [
    "-lc",
    `pacman -S --noconfirm --needed ${pkgList}`,
  ]);
}

beforeEach(() => {
  // resetAllMocks (not clearAllMocks) drops any lingering mock implementation
  // — e.g. a mockRejectedValue left over from a previous test — so each test
  // starts from a clean, default-resolving exec mock.
  jest.resetAllMocks();
  jest.useFakeTimers();
});

afterEach(() => {
  jest.useRealTimers();
});

describe("setupMSYS2", () => {
  it("installs the requested packages and exports the UCRT64 environment", async () => {
    await setupMSYS2(Msystem.UCRT64, ["gcc"]);

    expect(mockedExec).toHaveBeenCalledTimes(1);
    expectPacmanCall("mingw-w64-ucrt-x86_64-gcc");
    expect(core.addPath).toHaveBeenCalledWith(
      expect.stringContaining("ucrt64"),
    );
    expect(core.addPath).toHaveBeenCalledWith(expect.stringContaining("bin"));
    expect(core.exportVariable).toHaveBeenCalledWith("MSYSTEM", "UCRT64");
    expect(core.exportVariable).toHaveBeenCalledWith(
      "MSYS2_PATH_TYPE",
      "inherit",
    );
    expect(core.exportVariable).toHaveBeenCalledWith(
      "PKG_CONFIG_PATH",
      expect.stringContaining("pkgconfig"),
    );
  });

  it("installs multiple packages in a single pacman invocation", async () => {
    await setupMSYS2(Msystem.Clang64, ["gcc", "openblas"]);

    expect(mockedExec).toHaveBeenCalledTimes(1);
    expectPacmanCall(
      "mingw-w64-clang-x86_64-gcc mingw-w64-clang-x86_64-openblas",
    );
    expect(core.addPath).toHaveBeenCalledWith(
      expect.stringContaining("clang64"),
    );
  });

  it("does nothing when no packages are requested", async () => {
    await setupMSYS2(Msystem.UCRT64, []);

    expect(mockedExec).not.toHaveBeenCalled();
    expect(core.addPath).not.toHaveBeenCalled();
    expect(core.exportVariable).not.toHaveBeenCalled();
  });

  it("throws for the Native environment before invoking pacman", () => {
    expect(() => msys2PkgName(Msystem.Native, "gcc")).toThrow(
      "No MSYS2 package prefix known for environment: native",
    );
  });

  it("propagates a persistent install failure and skips environment setup", async () => {
    mockedExec.mockRejectedValue(new Error("mirror stalled"));

    const install = setupMSYS2(Msystem.UCRT64, ["gcc"]);
    // Attach the rejection handler before advancing timers: advanceTimersByTimeAsync
    // drains microtasks, which would otherwise reject `install` with no handler
    // (an unhandled rejection) before the assertion below can observe it.
    const expectation = expect(install).rejects.toThrow("mirror stalled");

    await jest.advanceTimersByTimeAsync(15_000);
    await jest.advanceTimersByTimeAsync(30_000);
    await expectation;

    expect(mockedExec).toHaveBeenCalledTimes(3);
    expect(core.addPath).not.toHaveBeenCalled();
    expect(core.exportVariable).not.toHaveBeenCalled();
  });
});

describe("pacmanInstallWithRetry", () => {
  it("installs on the first attempt without retrying", async () => {
    await pacmanInstallWithRetry("mingw-w64-ucrt-x86_64-gcc");

    expect(mockedExec).toHaveBeenCalledTimes(1);
    expectPacmanCall("mingw-w64-ucrt-x86_64-gcc");
    expect(mockedWarning).not.toHaveBeenCalled();
  });

  it("retries once and succeeds after a transient failure", async () => {
    mockedExec
      .mockRejectedValueOnce(new Error("mirror stalled"))
      .mockResolvedValueOnce(0);

    const install = pacmanInstallWithRetry("mingw-w64-ucrt-x86_64-gcc");

    await jest.advanceTimersByTimeAsync(15_000);
    await install;

    expect(mockedExec).toHaveBeenCalledTimes(2);
    expect(mockedWarning).toHaveBeenCalledTimes(1);
    expect(mockedWarning).toHaveBeenCalledWith(
      "pacman install failed (attempt 1/3), retrying in 15s...",
    );
  });

  it("escalates the backoff before each subsequent retry", async () => {
    mockedExec
      .mockRejectedValueOnce(new Error("first failure"))
      .mockRejectedValueOnce(new Error("second failure"))
      .mockResolvedValueOnce(0);

    const install = pacmanInstallWithRetry("mingw-w64-ucrt-x86_64-gcc");

    await jest.advanceTimersByTimeAsync(15_000);
    expect(mockedExec).toHaveBeenCalledTimes(2);
    expect(mockedWarning).toHaveBeenNthCalledWith(
      1,
      "pacman install failed (attempt 1/3), retrying in 15s...",
    );

    await jest.advanceTimersByTimeAsync(30_000);
    await install;

    expect(mockedExec).toHaveBeenCalledTimes(3);
    expect(mockedWarning).toHaveBeenNthCalledWith(
      2,
      "pacman install failed (attempt 2/3), retrying in 30s...",
    );
  });

  it("gives up after exhausting all retries and rethrows the last error", async () => {
    mockedExec.mockRejectedValue(new Error("mirror stalled"));

    const install = pacmanInstallWithRetry("mingw-w64-ucrt-x86_64-gcc", 3);
    const expectation = expect(install).rejects.toThrow("mirror stalled");

    await jest.advanceTimersByTimeAsync(15_000);
    await jest.advanceTimersByTimeAsync(30_000);
    await expectation;

    expect(mockedExec).toHaveBeenCalledTimes(3);
    expect(mockedWarning).toHaveBeenNthCalledWith(
      1,
      "pacman install failed (attempt 1/3), retrying in 15s...",
    );
    expect(mockedWarning).toHaveBeenNthCalledWith(
      2,
      "pacman install failed (attempt 2/3), retrying in 30s...",
    );
  });

  it("does not warn or retry when only one attempt is allowed", async () => {
    mockedExec.mockRejectedValue(new Error("mirror stalled"));

    await expect(
      pacmanInstallWithRetry("mingw-w64-ucrt-x86_64-gcc", 1),
    ).rejects.toThrow("mirror stalled");

    expect(mockedExec).toHaveBeenCalledTimes(1);
    expect(mockedWarning).not.toHaveBeenCalled();
  });
});
