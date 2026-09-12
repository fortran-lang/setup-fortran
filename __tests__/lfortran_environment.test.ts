import * as core from "@actions/core";
import * as exec from "@actions/exec";
import { condaCreateWithRetry } from "../src/lfortran_environment";

jest.mock("@actions/core");
jest.mock("@actions/exec");

const mockedExec = exec.exec as jest.MockedFunction<typeof exec.exec>;
const mockedWarning = core.warning as jest.MockedFunction<typeof core.warning>;

const CONDA_BIN = "/tool-cache/miniforge/bin/conda";
const CREATE_ARGS = [
  "create",
  "-y",
  "-p",
  "/tool-cache/env",
  "-c",
  "conda-forge",
  "lfortran==0.63.0",
];

beforeEach(() => {
  // resetAllMocks (not clearAllMocks) drops any lingering mock implementation
  // so each test starts from a clean, default-resolving exec mock.
  jest.resetAllMocks();
  jest.useFakeTimers();
});

afterEach(() => {
  jest.useRealTimers();
});

describe("condaCreateWithRetry", () => {
  it("creates the environment on the first attempt without retrying", async () => {
    mockedExec.mockResolvedValue(0);

    await condaCreateWithRetry(CONDA_BIN, CREATE_ARGS);

    expect(mockedExec).toHaveBeenCalledTimes(1);
    expect(mockedWarning).not.toHaveBeenCalled();
  });

  it("runs conda with ignoreReturnCode so a non-zero exit is retryable", async () => {
    mockedExec.mockResolvedValue(0);

    await condaCreateWithRetry(CONDA_BIN, CREATE_ARGS);

    expect(mockedExec).toHaveBeenCalledWith(
      CONDA_BIN,
      CREATE_ARGS,
      expect.objectContaining({ ignoreReturnCode: true }),
    );
  });

  it("retries once and succeeds after a transient failure", async () => {
    mockedExec.mockResolvedValueOnce(1).mockResolvedValueOnce(0);

    const install = condaCreateWithRetry(CONDA_BIN, CREATE_ARGS);

    await jest.advanceTimersByTimeAsync(15_000);
    await install;

    expect(mockedExec).toHaveBeenCalledTimes(2);
    expect(mockedWarning).toHaveBeenCalledTimes(1);
    expect(mockedWarning).toHaveBeenCalledWith(
      "conda create failed (attempt 1/3), retrying in 15s...",
    );
  });

  it("escalates the backoff before each subsequent retry", async () => {
    mockedExec
      .mockResolvedValueOnce(1)
      .mockResolvedValueOnce(1)
      .mockResolvedValueOnce(0);

    const install = condaCreateWithRetry(CONDA_BIN, CREATE_ARGS);

    await jest.advanceTimersByTimeAsync(15_000);
    expect(mockedExec).toHaveBeenCalledTimes(2);
    expect(mockedWarning).toHaveBeenNthCalledWith(
      1,
      "conda create failed (attempt 1/3), retrying in 15s...",
    );

    await jest.advanceTimersByTimeAsync(30_000);
    await install;

    expect(mockedExec).toHaveBeenCalledTimes(3);
    expect(mockedWarning).toHaveBeenNthCalledWith(
      2,
      "conda create failed (attempt 2/3), retrying in 30s...",
    );
  });

  it("gives up after exhausting all retries", async () => {
    mockedExec.mockResolvedValue(1);

    const install = condaCreateWithRetry(CONDA_BIN, CREATE_ARGS, 3);
    const expectation = expect(install).rejects.toThrow(
      "conda create failed after 3 attempts.",
    );

    await jest.advanceTimersByTimeAsync(15_000);
    await jest.advanceTimersByTimeAsync(30_000);
    await expectation;

    expect(mockedExec).toHaveBeenCalledTimes(3);
    expect(mockedWarning).toHaveBeenCalledTimes(2);
  });

  it("does not warn or retry when only one attempt is allowed", async () => {
    mockedExec.mockResolvedValue(1);

    await expect(
      condaCreateWithRetry(CONDA_BIN, CREATE_ARGS, 1),
    ).rejects.toThrow("conda create failed after 1 attempts.");

    expect(mockedExec).toHaveBeenCalledTimes(1);
    expect(mockedWarning).not.toHaveBeenCalled();
  });
});
