import * as exec from "@actions/exec";
import * as tc from "@actions/tool-cache";
import { Resolver } from "dns/promises";
import { downloadInstaller } from "../src/download_installer";

jest.mock("@actions/core");
jest.mock("@actions/exec");
jest.mock("@actions/tool-cache");
jest.mock("dns/promises", () => ({
  Resolver: jest.fn(),
}));

const URL =
  "https://registrationcenter-download.intel.com/akdlm/IRC_NAS/test-id/m_HPCKit_p_test.dmg";
const DEST = "/tmp/test-installer.dmg";
const HOST = "registrationcenter-download.intel.com";
const REAL_PLATFORM = process.platform;

const mockedExec = exec.exec as jest.MockedFunction<typeof exec.exec>;
const mockedDownloadTool = tc.downloadTool as jest.MockedFunction<
  typeof tc.downloadTool
>;
const MockResolver = Resolver as unknown as jest.Mock;
const mockSetServers = jest.fn();
const mockResolve4 = jest.fn();

function setPlatform(value: NodeJS.Platform): void {
  Object.defineProperty(process, "platform", { value });
}

// Runs pending setTimeout backoffs (the retry delays) immediately.
function immediateTimers(): () => void {
  const spy = jest
    .spyOn(global, "setTimeout")
    .mockImplementation((callback: Parameters<typeof setTimeout>[0]) => {
      if (typeof callback === "function") callback();
      return 0 as unknown as NodeJS.Timeout;
    });
  return () => spy.mockRestore();
}

beforeEach(() => {
  jest.clearAllMocks();
  setPlatform(REAL_PLATFORM);
  mockSetServers.mockClear();
  mockResolve4.mockReset();
  MockResolver.mockImplementation(
    () => ({ setServers: mockSetServers, resolve4: mockResolve4 }) as never,
  );
  mockedExec.mockResolvedValue(0);
});

afterEach(() => {
  setPlatform(REAL_PLATFORM);
});

describe("downloadInstaller", () => {
  it("downloads via tool-cache on the first attempt", async () => {
    mockedDownloadTool.mockResolvedValue(DEST);

    await expect(downloadInstaller(URL, DEST)).resolves.toBe(DEST);

    expect(mockedDownloadTool).toHaveBeenCalledTimes(1);
    expect(mockedExec).not.toHaveBeenCalled();
  });

  it("flushes the system DNS cache between retries on macOS", async () => {
    setPlatform("darwin");
    mockedDownloadTool
      .mockRejectedValueOnce(new Error("getaddrinfo ENOTFOUND"))
      .mockResolvedValue(DEST);
    const restoreTimers = immediateTimers();

    try {
      await expect(downloadInstaller(URL, DEST)).resolves.toBe(DEST);
    } finally {
      restoreTimers();
    }

    expect(mockedDownloadTool).toHaveBeenCalledTimes(2);
    expect(mockedExec).toHaveBeenCalledWith(
      "sudo",
      ["dscacheutil", "-flushcache"],
      expect.objectContaining({ ignoreReturnCode: true }),
    );
    expect(mockedExec).toHaveBeenCalledWith(
      "sudo",
      ["killall", "-HUP", "mDNSResponder"],
      expect.objectContaining({ ignoreReturnCode: true }),
    );
  });

  it("skips the DNS flush on other platforms", async () => {
    setPlatform("linux");
    mockedDownloadTool
      .mockRejectedValueOnce(new Error("getaddrinfo ENOTFOUND"))
      .mockResolvedValue(DEST);
    const restoreTimers = immediateTimers();

    try {
      await expect(downloadInstaller(URL, DEST)).resolves.toBe(DEST);
    } finally {
      restoreTimers();
    }

    expect(mockedDownloadTool).toHaveBeenCalledTimes(2);
    expect(mockedExec).not.toHaveBeenCalledWith(
      "sudo",
      expect.arrayContaining(["dscacheutil"]),
    );
  });

  it("falls back to curl with resilient flags after tool-cache fails", async () => {
    mockedDownloadTool.mockRejectedValue(new Error("socket hang up"));
    const restoreTimers = immediateTimers();

    try {
      await expect(downloadInstaller(URL, DEST)).resolves.toBe(DEST);
    } finally {
      restoreTimers();
    }

    expect(mockedDownloadTool).toHaveBeenCalledTimes(3);
    expect(mockedExec).toHaveBeenCalledWith(
      "curl",
      expect.arrayContaining([
        "--fail",
        "-4",
        "--retry-all-errors",
        "-o",
        DEST,
        URL,
      ]),
    );
  });

  it("pins public-DNS addresses via --resolve when the runner resolver fails", async () => {
    mockedDownloadTool.mockRejectedValue(new Error("getaddrinfo ENOTFOUND"));
    mockResolve4.mockResolvedValue(["93.184.216.34"]);
    mockedExec.mockImplementation(async (commandLine) => {
      // Fail the plain curl fallback; the --resolve-pinned retry succeeds.
      if (commandLine === "curl") {
        const calls = mockedExec.mock.calls.filter(
          ([cmd]) => cmd === "curl",
        ).length;
        if (calls === 1) throw new Error("Could not resolve host");
      }
      return 0;
    });
    const restoreTimers = immediateTimers();

    try {
      await expect(downloadInstaller(URL, DEST)).resolves.toBe(DEST);
    } finally {
      restoreTimers();
    }

    expect(mockSetServers).toHaveBeenCalledWith(
      expect.arrayContaining(["8.8.8.8"]),
    );
    expect(mockedExec).toHaveBeenCalledWith(
      "curl",
      expect.arrayContaining(["--resolve", `${HOST}:443:93.184.216.34`]),
    );
  });

  it("throws when public DNS has no addresses either", async () => {
    mockedDownloadTool.mockRejectedValue(new Error("getaddrinfo ENOTFOUND"));
    mockResolve4.mockRejectedValue(new Error("queryA ENOTFOUND"));
    mockedExec.mockImplementation(async (commandLine) => {
      if (commandLine === "curl") throw new Error("Could not resolve host");
      return 0;
    });
    const restoreTimers = immediateTimers();

    try {
      await expect(downloadInstaller(URL, DEST)).rejects.toThrow(
        "queryA ENOTFOUND",
      );
    } finally {
      restoreTimers();
    }
  });
});
