import * as exec from "@actions/exec";
import * as tc from "@actions/tool-cache";
import { downloadInstaller } from "../src/download_installer";

jest.mock("@actions/core");
jest.mock("@actions/exec");
jest.mock("@actions/tool-cache");

const URL =
  "https://registrationcenter-download.intel.com/akdlm/IRC_NAS/test-id/m_HPCKit_p_test.dmg";
const DEST = "/tmp/test-installer.dmg";
const HOST = "registrationcenter-download.intel.com";
const REAL_PLATFORM = process.platform;

// Mirrors the shape of a dns.google/resolve answer for the Akamai chain:
// the A records belong to a1928.d.akamai.net, not to the queried name.
const DOH_BODY = JSON.stringify({
  Status: 0,
  Question: [{ name: HOST, type: 1 }],
  Answer: [
    { name: HOST, type: 5, TTL: 51, data: "a1928.d.akamai.net." },
    { name: "a1928.d.akamai.net.", type: 1, TTL: 20, data: "192.0.2.1" },
    { name: "a1928.d.akamai.net.", type: 1, TTL: 20, data: "192.0.2.2" },
  ],
});

const DOH_GOOGLE = "https://dns.google/resolve";
const DOH_CLOUDFLARE = "https://cloudflare-dns.com/dns-query";

const mockedExec = exec.exec as jest.MockedFunction<typeof exec.exec>;
const mockedDownloadTool = tc.downloadTool as jest.MockedFunction<
  typeof tc.downloadTool
>;

function isDohCall(command: string, args?: readonly string[]): boolean {
  return (
    command === "curl" &&
    (args ?? []).some(
      (arg) =>
        arg.startsWith(`${DOH_GOOGLE}?`) ||
        arg.startsWith(`${DOH_CLOUDFLARE}?`),
    )
  );
}

function isPinnedDownload(command: string, args?: readonly string[]): boolean {
  return command === "curl" && (args ?? []).includes("--resolve");
}

// DoH answers; every unpinned download attempt fails to resolve the host, so
// the code never escapes the fallback chain.
function mockResolverFailure(): void {
  mockedExec.mockImplementation(async (command, args, options) => {
    if (isDohCall(command, args)) {
      options?.listeners?.stdout?.(Buffer.from(DOH_BODY));
      return 0;
    }
    if (command === "curl" && !isPinnedDownload(command, args)) {
      throw new Error("Could not resolve host");
    }
    return 0;
  });
}

// Every DoH endpoint is unreachable, so the fallback has to come back and
// keep retrying the resolver path.
function mockDohUnavailable(): void {
  mockedExec.mockImplementation(async (command, args) => {
    if (isDohCall(command, args)) {
      return 6; // curl: could not resolve host
    }
    return 0;
  });
}

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
    mockDohUnavailable();
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
    mockDohUnavailable();
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

  it("pins DNS-over-HTTPS addresses via --resolve when the runner resolver fails", async () => {
    mockedDownloadTool.mockRejectedValue(new Error("getaddrinfo ENOTFOUND"));
    mockResolverFailure();
    const restoreTimers = immediateTimers();

    try {
      await expect(downloadInstaller(URL, DEST)).resolves.toBe(DEST);
    } finally {
      restoreTimers();
    }

    // Both Akamai A records from the DoH answer are pinned.
    expect(mockedExec).toHaveBeenCalledWith(
      "curl",
      expect.arrayContaining(["--resolve", `${HOST}:443:192.0.2.1,192.0.2.2`]),
    );

    // --fail, so an HTTP error is reported as such rather than as a
    // "non-JSON body".
    const dohArgs = mockedExec.mock.calls.find(([cmd, args]) =>
      isDohCall(cmd, args),
    )?.[1];
    expect(dohArgs).toEqual(expect.arrayContaining(["--fail"]));
    expect(dohArgs).toContainEqual(expect.stringContaining(`${DOH_GOOGLE}?`));
  });

  it("re-resolves just-in-time rather than pinning stale addresses", async () => {
    mockedDownloadTool.mockRejectedValue(new Error("getaddrinfo ENOTFOUND"));
    mockedExec.mockImplementation(async (command, args, options) => {
      if (isDohCall(command, args)) {
        options?.listeners?.stdout?.(Buffer.from(DOH_BODY));
        return 0;
      }
      // Even the pinned download fails, so the resolve/pin pair retries.
      if (command === "curl") throw new Error("Could not resolve host");
      return 0;
    });
    const restoreTimers = immediateTimers();

    try {
      await expect(downloadInstaller(URL, DEST)).rejects.toThrow();
    } finally {
      restoreTimers();
    }

    // DoH is queried again per attempt instead of reusing one answer.
    const dohCalls = mockedExec.mock.calls.filter(([cmd, args]) =>
      isDohCall(cmd, args),
    );
    expect(dohCalls.length).toBeGreaterThanOrEqual(3);
  });

  it("skips the curl retry when resolution is known to be broken", async () => {
    mockedDownloadTool.mockRejectedValue(
      new Error("getaddrinfo ENOTFOUND registrationcenter-download.intel.com"),
    );
    mockResolverFailure();
    const restoreTimers = immediateTimers();

    try {
      await expect(downloadInstaller(URL, DEST)).resolves.toBe(DEST);
    } finally {
      restoreTimers();
    }

    // tool-cache is abandoned after one resolution failure instead of three,
    // and plain curl is never attempted.
    expect(mockedDownloadTool).toHaveBeenCalledTimes(1);
    const plainCurlCalls = mockedExec.mock.calls.filter(
      ([cmd, args]) =>
        cmd === "curl" && !isPinnedDownload(cmd, args) && !isDohCall(cmd, args),
    );
    expect(plainCurlCalls).toHaveLength(0);
  });

  it("keeps retrying the resolver path when DoH also fails", async () => {
    mockedDownloadTool
      .mockRejectedValueOnce(new Error("getaddrinfo ENOTFOUND"))
      .mockResolvedValue(DEST);
    mockDohUnavailable();
    const restoreTimers = immediateTimers();

    try {
      await expect(downloadInstaller(URL, DEST)).resolves.toBe(DEST);
    } finally {
      restoreTimers();
    }

    // The DoH intervention is a shortcut, not a replacement: when it fails
    // the tool-cache retries still run.
    expect(mockedDownloadTool).toHaveBeenCalledTimes(2);
    expect(mockedExec).toHaveBeenCalledWith(
      "sudo",
      ["dscacheutil", "-flushcache"],
      expect.objectContaining({ ignoreReturnCode: true }),
    );
  });

  it("keeps retrying when the failure is transport, not resolution", async () => {
    mockedDownloadTool.mockRejectedValue(new Error("socket hang up"));
    mockedExec.mockImplementation(async (command, args, options) => {
      if (isDohCall(command, args)) {
        options?.listeners?.stdout?.(Buffer.from(DOH_BODY));
      }
      return 0;
    });
    const restoreTimers = immediateTimers();

    try {
      await expect(downloadInstaller(URL, DEST)).resolves.toBe(DEST);
    } finally {
      restoreTimers();
    }

    // Full three tool-cache attempts plus the plain curl fallback, as before.
    expect(mockedDownloadTool).toHaveBeenCalledTimes(3);
    expect(mockedExec).toHaveBeenCalledWith(
      "curl",
      expect.arrayContaining(["--retry-all-errors", "-o", DEST, URL]),
    );
  });

  it("rotates to the next DoH provider when the first one fails", async () => {
    mockedDownloadTool.mockRejectedValue(new Error("getaddrinfo ENOTFOUND"));
    const endpointsSeen: string[] = [];
    mockedExec.mockImplementation(async (command, args, options) => {
      if (isDohCall(command, args)) {
        const [base] = (
          (args ?? []).find(
            (a) =>
              a.startsWith(`${DOH_GOOGLE}?`) ||
              a.startsWith(`${DOH_CLOUDFLARE}?`),
          ) ?? ""
        ).split("?");
        endpointsSeen.push(base);
        if (base === DOH_GOOGLE) return 2;
        options?.listeners?.stdout?.(Buffer.from(DOH_BODY));
        return 0;
      }
      if (command === "curl" && !isPinnedDownload(command, args)) {
        throw new Error("Could not resolve host");
      }
      return 0;
    });
    const restoreTimers = immediateTimers();

    try {
      await expect(downloadInstaller(URL, DEST)).resolves.toBe(DEST);
    } finally {
      restoreTimers();
    }

    expect(endpointsSeen[0]).toBe(DOH_GOOGLE);
    expect(endpointsSeen[1]).toBe(DOH_CLOUDFLARE);
  });

  it("throws a descriptive error when every DoH provider fails", async () => {
    mockedDownloadTool.mockRejectedValue(new Error("getaddrinfo ENOTFOUND"));
    mockedExec.mockImplementation(async (command, args, options) => {
      if (isDohCall(command, args)) {
        const query =
          (args ?? []).find(
            (a) =>
              a.startsWith(`${DOH_GOOGLE}?`) ||
              a.startsWith(`${DOH_CLOUDFLARE}?`),
          ) ?? "";
        if (query.startsWith(DOH_GOOGLE)) return 22;
        if (query.startsWith(DOH_CLOUDFLARE)) {
          options?.listeners?.stdout?.(
            Buffer.from(JSON.stringify({ Status: 3 })),
          );
          return 0;
        }
      }
      if (command === "curl" && !isPinnedDownload(command, args)) {
        throw new Error("Could not resolve host");
      }
      return 0;
    });
    const restoreTimers = immediateTimers();

    try {
      await expect(downloadInstaller(URL, DEST)).rejects.toThrow(
        /DNS-over-HTTPS/,
      );
    } finally {
      restoreTimers();
    }
  });

  it("reports a non-JSON DoH body descriptively", async () => {
    mockedDownloadTool.mockRejectedValue(new Error("getaddrinfo ENOTFOUND"));
    mockedExec.mockImplementation(async (command, args, options) => {
      if (isDohCall(command, args)) {
        options?.listeners?.stdout?.(Buffer.from("<html>not json</html>"));
        return 0;
      }
      if (command === "curl" && !isPinnedDownload(command, args)) {
        throw new Error("Could not resolve host");
      }
      return 0;
    });
    const restoreTimers = immediateTimers();

    try {
      await expect(downloadInstaller(URL, DEST)).rejects.toThrow(
        /non-JSON body/,
      );
    } finally {
      restoreTimers();
    }
  });

  it("reports a DoH answer with no A records descriptively", async () => {
    mockedDownloadTool.mockRejectedValue(new Error("getaddrinfo ENOTFOUND"));
    mockedExec.mockImplementation(async (command, args, options) => {
      if (isDohCall(command, args)) {
        options?.listeners?.stdout?.(
          Buffer.from(JSON.stringify({ Status: 0 })),
        );
        return 0;
      }
      if (command === "curl" && !isPinnedDownload(command, args)) {
        throw new Error("Could not resolve host");
      }
      return 0;
    });
    const restoreTimers = immediateTimers();

    try {
      await expect(downloadInstaller(URL, DEST)).rejects.toThrow(
        /no A records/,
      );
    } finally {
      restoreTimers();
    }
  });
});
