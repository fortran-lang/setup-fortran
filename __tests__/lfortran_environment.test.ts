import * as core from "@actions/core";
import * as exec from "@actions/exec";
import {
  applyMiniforgeTimeoutEnv,
  condaCreateWithRetry,
} from "../src/lfortran_environment";

jest.mock("@actions/core");
jest.mock("@actions/exec");

const mockedExec = exec.exec as jest.MockedFunction<typeof exec.exec>;
const mockedInfo = core.info as jest.MockedFunction<typeof core.info>;

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
    expect(mockedInfo).not.toHaveBeenCalled();
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
    expect(mockedInfo).toHaveBeenCalledTimes(1);
    expect(mockedInfo).toHaveBeenCalledWith(
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
    expect(mockedInfo).toHaveBeenNthCalledWith(
      1,
      "conda create failed (attempt 1/3), retrying in 15s...",
    );

    await jest.advanceTimersByTimeAsync(30_000);
    await install;

    expect(mockedExec).toHaveBeenCalledTimes(3);
    expect(mockedInfo).toHaveBeenNthCalledWith(
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
    expect(mockedInfo).toHaveBeenCalledTimes(2);
  });

  it("does not warn or retry when only one attempt is allowed", async () => {
    mockedExec.mockResolvedValue(1);

    await expect(
      condaCreateWithRetry(CONDA_BIN, CREATE_ARGS, 1),
    ).rejects.toThrow("conda create failed after 1 attempts.");

    expect(mockedExec).toHaveBeenCalledTimes(1);
    expect(mockedInfo).not.toHaveBeenCalled();
  });
});

describe("applyMiniforgeTimeoutEnv", () => {
  const NETWORK_ENV_KEYS = [
    "MAMBA_REMOTE_CONNECT_TIMEOUT_SECS",
    "MAMBA_REMOTE_MAX_RETRIES",
    "MAMBA_REMOTE_BACKOFF_FACTOR",
    "MAMBA_NO_LOW_SPEED_LIMIT",
    "CONDA_REMOTE_CONNECT_TIMEOUT_SECS",
    "CONDA_REMOTE_READ_TIMEOUT_SECS",
    "CONDA_REMOTE_MAX_RETRIES",
    "CONDA_REMOTE_BACKOFF_FACTOR",
  ] as const;
  let savedEnv: Record<string, string | undefined>;

  beforeEach(() => {
    savedEnv = {};
    for (const key of NETWORK_ENV_KEYS) {
      savedEnv[key] = process.env[key];
      delete process.env[key];
    }
  });

  afterEach(() => {
    for (const key of NETWORK_ENV_KEYS) {
      const value = savedEnv[key];
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  });

  it("sets network settings for both micromamba and conda", () => {
    applyMiniforgeTimeoutEnv();

    expect(process.env.MAMBA_REMOTE_CONNECT_TIMEOUT_SECS).toBe("120");
    expect(process.env.MAMBA_REMOTE_MAX_RETRIES).toBe("5");
    expect(process.env.MAMBA_REMOTE_BACKOFF_FACTOR).toBe("2");
    expect(process.env.MAMBA_NO_LOW_SPEED_LIMIT).toBe("1");
    expect(process.env.CONDA_REMOTE_CONNECT_TIMEOUT_SECS).toBe("120");
    expect(process.env.CONDA_REMOTE_READ_TIMEOUT_SECS).toBe("300");
    expect(process.env.CONDA_REMOTE_MAX_RETRIES).toBe("5");
    expect(process.env.CONDA_REMOTE_BACKOFF_FACTOR).toBe("2");
  });

  it("does not override values already set by the user", () => {
    process.env.MAMBA_REMOTE_CONNECT_TIMEOUT_SECS = "42";
    process.env.CONDA_REMOTE_READ_TIMEOUT_SECS = "99";

    applyMiniforgeTimeoutEnv();

    expect(process.env.MAMBA_REMOTE_CONNECT_TIMEOUT_SECS).toBe("42");
    expect(process.env.CONDA_REMOTE_READ_TIMEOUT_SECS).toBe("99");
    expect(process.env.MAMBA_REMOTE_MAX_RETRIES).toBe("5");
  });
});
