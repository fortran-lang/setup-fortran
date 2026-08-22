import {
  resolveVersion,
  resolveWindowsVersion,
  resolveLatestPatch,
  verifyAssetExists,
  stripTrailingPatchZero,
} from "../src/resolve_version";
import { Arch, Compiler, LATEST, OS, Msystem } from "../src/types";
import type { Inputs } from "../src/types";
import * as core from "@actions/core";

jest.mock("@actions/core");

const baseInputs: Inputs = {
  compiler: Compiler.GFortran,
  version: LATEST,
  os: OS.Linux,
  osVersion: "22.04",
  arch: Arch.X64,
  msystem: Msystem.Native,
  cleanupDisk: false,
  updateEnvironment: true,
};

const SUPPORTED: Record<string, readonly string[]> = {
  [Arch.X64]: ["15", "14", "13"],
  [Arch.ARM64]: ["14", "13"],
};

describe("resolveVersion", () => {
  beforeAll(() => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => [{ tag_name: "llvmorg-19.1.7", prerelease: false }],
    } as unknown as Response);
  });

  afterEach(() => {
    jest.clearAllMocks();
    jest.useRealTimers();
  });

  afterAll(() => {
    jest.restoreAllMocks();
  });

  describe("when version is LATEST", () => {
    it("returns the first entry for x64", () => {
      const result = resolveVersion(baseInputs, SUPPORTED);
      expect(result).toBe("15");
    });

    it("returns the first entry for arm64", () => {
      const inputs: Inputs = { ...baseInputs, arch: Arch.ARM64 };
      const result = resolveVersion(inputs, SUPPORTED);
      expect(result).toBe("14");
    });
  });

  describe("when a specific version is requested", () => {
    it("returns the version if it is supported", () => {
      const inputs: Inputs = { ...baseInputs, version: "14" };
      const result = resolveVersion(inputs, SUPPORTED);
      expect(result).toBe("14");
    });

    it("handles 2-part versions like 24.1 if present in supported list", () => {
      const inputs: Inputs = { ...baseInputs, version: "24.1" };
      const supported = { [Arch.X64]: ["24.3", "24.1"] };
      const result = resolveVersion(inputs, supported);
      expect(result).toBe("24.1");
    });

    it("throws if the version is not supported on this arch", () => {
      const inputs: Inputs = { ...baseInputs, arch: Arch.ARM64, version: "15" };
      expect(() => resolveVersion(inputs, SUPPORTED)).toThrow(
        "gfortran 15 is not supported on linux (arm64). Supported versions: 14, 13",
      );
    });

    it("throws if the version is not supported on any arch", () => {
      const inputs: Inputs = { ...baseInputs, version: "9" };
      expect(() => resolveVersion(inputs, SUPPORTED)).toThrow(
        "gfortran 9 is not supported on linux (x64). Supported versions: 15, 14, 13",
      );
    });
  });

  describe("resolveMinorToLatestPatch", () => {
    const supported = {
      [Arch.X64]: ["2025.2.1", "2025.2.0", "2025.1.0", "2024.0.0"],
    };

    it("resolves YYYY.minor to the latest patch if resolveMinorToLatestPatch is true", () => {
      const inputs: Inputs = { ...baseInputs, version: "2025.2" };
      const result = resolveVersion(inputs, supported, {
        resolveMinorToLatestPatch: true,
      });
      expect(result).toBe("2025.2.1");
    });

    it("returns the original version if resolveMinorToLatestPatch is false", () => {
      const inputs: Inputs = { ...baseInputs, version: "2024.0.0" };
      const result = resolveVersion(inputs, supported, {
        resolveMinorToLatestPatch: false,
      });
      expect(result).toBe("2024.0.0");
    });

    it("does not affect 3-part versions", () => {
      const inputs: Inputs = { ...baseInputs, version: "2025.2.0" };
      const result = resolveVersion(inputs, supported, {
        resolveMinorToLatestPatch: true,
      });
      expect(result).toBe("2025.2.0");
    });

    it("returns the latest patch even if the requested version is a latest patch", () => {
      const inputs: Inputs = { ...baseInputs, version: "2025.2.1" };
      const result = resolveVersion(inputs, supported, {
        resolveMinorToLatestPatch: true,
      });
      expect(result).toBe("2025.2.1");
    });
  });

  describe("stripPatchZero option", () => {
    const supported = {
      [Arch.X64]: ["5.2", "5.1", "5.0", "4.2", "4.1"],
    };

    const mockedWarning = core.warning as jest.MockedFunction<typeof core.warning>;

    beforeEach(() => {
      mockedWarning.mockClear();
    });

    it("normalizes X.Y.0 to X.Y when stripPatchZero is true", () => {
      const inputs: Inputs = { ...baseInputs, compiler: Compiler.AOCC, version: "5.1.0" };
      const result = resolveVersion(inputs, supported, { stripPatchZero: true });
      expect(result).toBe("5.1");
      expect(mockedWarning).toHaveBeenCalledWith(
        expect.stringContaining(
          'normalized to "5.1". Consider dropping the patch number.',
        ),
      );
    });

    it("normalizes X.Y.0 for any AOCC-like version", () => {
      const inputs: Inputs = { ...baseInputs, compiler: Compiler.AOCC, version: "4.2.0" };
      const result = resolveVersion(inputs, supported, { stripPatchZero: true });
      expect(result).toBe("4.2");
      expect(mockedWarning).toHaveBeenCalledWith(
        expect.stringContaining(
          'normalized to "4.2". Consider dropping the patch number.',
        ),
      );
    });

    it("leaves X.Y untouched when stripPatchZero is true", () => {
      const inputs: Inputs = { ...baseInputs, compiler: Compiler.AOCC, version: "5.1" };
      const result = resolveVersion(inputs, supported, { stripPatchZero: true });
      expect(result).toBe("5.1");
      expect(mockedWarning).not.toHaveBeenCalled();
    });

    it("does not normalize X.Y.1 (non-zero patch) and fails clearly", () => {
      const inputs: Inputs = { ...baseInputs, compiler: Compiler.AOCC, version: "5.1.1" };
      expect(() =>
        resolveVersion(inputs, supported, { stripPatchZero: true }),
      ).toThrow(
        "aocc 5.1.1 is not supported on linux (x64). Supported versions: 5.2, 5.1, 5.0, 4.2, 4.1",
      );
      expect(mockedWarning).not.toHaveBeenCalled();
    });

    it("does not normalize when stripPatchZero is false (default)", () => {
      const inputs: Inputs = { ...baseInputs, compiler: Compiler.AOCC, version: "5.1.0" };
      expect(() => resolveVersion(inputs, supported)).toThrow(
        "aocc 5.1.0 is not supported on linux (x64). Supported versions: 5.2, 5.1, 5.0, 4.2, 4.1",
      );
      expect(mockedWarning).not.toHaveBeenCalled();
    });

    it("still resolves latest when stripPatchZero is true", () => {
      const inputs: Inputs = { ...baseInputs, compiler: Compiler.AOCC, version: LATEST };
      const result = resolveVersion(inputs, supported, { stripPatchZero: true });
      expect(result).toBe("5.2");
      expect(mockedWarning).not.toHaveBeenCalled();
    });
  });
});

describe("stripTrailingPatchZero", () => {
  it.each([
    ["5.1.0", "5.1"],
    ["4.2.0", "4.2"],
    ["5.0.0", "5.0"],
    ["10.1.0", "10.1"],
  ])("normalizes %s to %s", (input, expected) => {
    expect(stripTrailingPatchZero(input)).toBe(expected);
  });

  it.each(["5.1", "5.1.1", "5.1.2", "latest", "5", "5.0.1"])(
    "leaves %s unchanged",
    (input) => {
      expect(stripTrailingPatchZero(input)).toBe(input);
    },
  );
});

describe("resolveWindowsVersion", () => {
  const winInputs: Inputs = {
    ...baseInputs,
    os: OS.Windows,
    osVersion: "2022",
    arch: Arch.X64,
    msystem: Msystem.Native,
  };

  const SUPPORTED_WIN = {
    [Arch.X64]: {
      [Msystem.Native]: ["14", "13"],
      [Msystem.UCRT64]: ["latest"],
    }
  };

  it("returns the requested version if it matches the first entry for x64", () => {
    const result = resolveWindowsVersion(winInputs, SUPPORTED_WIN as any);
    expect(result).toBe("14");
  });

  it("returns the requested version if supported", () => {
    const inputs: Inputs = { ...winInputs, version: "13" };
    const result = resolveWindowsVersion(inputs, SUPPORTED_WIN as any);
    expect(result).toBe("13");
  });

  it("returns latest for UCRT64 msystem", () => {
    const inputs: Inputs = { ...winInputs, msystem: Msystem.UCRT64 };
    const result = resolveWindowsVersion(inputs, SUPPORTED_WIN as any);
    expect(result).toBe("latest");
  });

  it("throws if version is not supported", () => {
    const inputs: Inputs = { ...winInputs, version: "9" };
    expect(() => resolveWindowsVersion(inputs, SUPPORTED_WIN as any)).toThrow(
      "gfortran 9 is not supported on win32 (x64). Supported versions: 14, 13",
    );
  });
});

describe("resolveLatestPatch", () => {
  beforeEach(() => {
    jest.useFakeTimers();
    global.fetch = jest.fn();
  });

  afterEach(() => {
    jest.clearAllMocks();
    jest.useRealTimers();
  });

  it("resolves the latest patch version correctly", async () => {
    const mockFetch = global.fetch as jest.Mock;
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => [{ tag_name: "llvmorg-19.1.7", prerelease: false }],
    });

    const result = await resolveLatestPatch("llvm/llvm-project", "19");
    expect(result).toBe("19.1.7");
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it("retries on HTTP error and eventually succeeds", async () => {
    const mockFetch = global.fetch as jest.Mock;
    mockFetch
      .mockResolvedValueOnce({
        ok: false,
        status: 500,
        statusText: "Internal Server Error",
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => [{ tag_name: "llvmorg-19.1.7", prerelease: false }],
      });

    const promise = resolveLatestPatch("llvm/llvm-project", "19");
    
    await Promise.resolve();
    await Promise.resolve();

    await jest.advanceTimersByTimeAsync(4000);

    const result = await promise;
    expect(result).toBe("19.1.7");
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it("retries on timeout and eventually succeeds", async () => {
    const mockFetch = global.fetch as jest.Mock;
    
    mockFetch.mockImplementationOnce((_url, options) => new Promise((_resolve, reject) => {
      if (options.signal) {
        options.signal.addEventListener("abort", () => {
          const error = new Error("The operation was aborted");
          error.name = "AbortError";
          reject(error);
        });
      }
    }));
    
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => [{ tag_name: "llvmorg-19.1.7", prerelease: false }],
    });

    const promise = resolveLatestPatch("llvm/llvm-project", "19");

    await Promise.resolve();
    await Promise.resolve();

    await jest.advanceTimersByTimeAsync(5000);
    
    await Promise.resolve();
    await Promise.resolve();

    await jest.advanceTimersByTimeAsync(4000);

    const result = await promise;
    expect(result).toBe("19.1.7");
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it("throws error after exhausting all retries", async () => {
    const mockFetch = global.fetch as jest.Mock;
    mockFetch.mockResolvedValue({
      ok: false,
      status: 502,
      statusText: "Bad Gateway",
    });

    const promise = resolveLatestPatch("llvm/llvm-project", "19");
    promise.catch(() => {});

    await Promise.resolve();
    await Promise.resolve();

    await jest.advanceTimersByTimeAsync(4000);
    
    await Promise.resolve();
    await Promise.resolve();

    await jest.advanceTimersByTimeAsync(8000);
    
    await Promise.resolve();
    await Promise.resolve();

    await expect(promise).rejects.toThrow("Request failed after 3 attempts");
    expect(mockFetch).toHaveBeenCalledTimes(3);
  });

  it("respects custom tagPrefix and tagStripper", async () => {
    const mockFetch = global.fetch as jest.Mock;
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => [{ tag_name: "v1.2.3", prerelease: false }],
    });

    const result = await resolveLatestPatch(
      "repo",
      "1",
      "v1.",
      (tag) => tag.substring(1)
    );
    expect(result).toBe("1.2.3");
  });

  it("throws error if no stable release is found", async () => {
    const mockFetch = global.fetch as jest.Mock;
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => [
        { tag_name: "llvmorg-19.1.0-rc1", prerelease: false },
        { tag_name: "llvmorg-20.0.0", prerelease: true },
      ],
    });

    const promise = resolveLatestPatch("llvm/llvm-project", "19");
    
    await expect(promise).rejects.toThrow(
      "No stable release found for llvm/llvm-project major 19 within visible historical GitHub releases."
    );
    expect(mockFetch).toHaveBeenCalledTimes(3);
  });

  it("waits for a nearby GitHub rate-limit reset", async () => {
    const mockFetch = global.fetch as jest.Mock;
    const resetTime = Math.floor(Date.now() / 1000) + 2;

    mockFetch
      .mockResolvedValueOnce({
        ok: false,
        status: 403,
        headers: new Headers({
          "x-ratelimit-reset": resetTime.toString(),
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => [{ tag_name: "llvmorg-19.1.7", prerelease: false }],
      });

    const promise = resolveLatestPatch("llvm/llvm-project", "19");

    await Promise.resolve();
    await Promise.resolve();

    await jest.advanceTimersByTimeAsync(3000);

    const result = await promise;
    expect(result).toBe("19.1.7");
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it("fails immediately when the GitHub rate-limit reset is too distant", async () => {
    const mockFetch = global.fetch as jest.Mock;
    const resetTime = Math.floor(Date.now() / 1000) + 60 * 60;
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 403,
      headers: new Headers({
        "x-ratelimit-reset": resetTime.toString(),
      }),
    });

    await expect(resolveLatestPatch("llvm/llvm-project", "19")).rejects.toThrow(
      /exceeds the 30-second maximum wait.*GITHUB_TOKEN/,
    );
    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(core.warning).not.toHaveBeenCalledWith(
      expect.stringContaining("Sleeping for"),
    );
  });

  it("reports an invalid GitHub rate-limit reset header", async () => {
    const mockFetch = global.fetch as jest.Mock;
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 429,
      headers: new Headers({ "x-ratelimit-reset": "not-a-timestamp" }),
    });

    await expect(resolveLatestPatch("llvm/llvm-project", "19")).rejects.toThrow(
      "invalid x-ratelimit-reset value",
    );
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it("fails safely when a rate-limit response has no reset header", async () => {
    const mockFetch = global.fetch as jest.Mock;
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 429,
      headers: new Headers(),
    });

    await expect(resolveLatestPatch("llvm/llvm-project", "19")).rejects.toThrow(
      /without a usable x-ratelimit-reset header.*cannot retry safely/,
    );
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });
});

describe("verifyAssetExists", () => {
  beforeEach(() => {
    jest.useFakeTimers();
    global.fetch = jest.fn();
  });

  afterEach(() => {
    jest.clearAllMocks();
    jest.useRealTimers();
  });

  it("verifies asset existence successfully", async () => {
    const mockFetch = global.fetch as jest.Mock;
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        assets: [{ name: "fortran.tar.gz" }, { name: "other.zip" }],
      }),
    });

    await expect(
      verifyAssetExists("repo", "19.1.7", "fortran.tar.gz")
    ).resolves.not.toThrow();
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it("returns the GitHub-provided SHA-256 digest", async () => {
    const mockFetch = global.fetch as jest.Mock;
    const digest = "a".repeat(64);
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        assets: [{ name: "fortran.tar.gz", digest: `sha256:${digest}` }],
      }),
    });

    await expect(
      verifyAssetExists("repo", "19.1.7", "fortran.tar.gz")
    ).resolves.toBe(digest);
  });

  it("throws error if release does not exist (404)", async () => {
    const mockFetch = global.fetch as jest.Mock;
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 404,
      json: async () => ({ message: "Not Found" }),
    });

    await expect(
      verifyAssetExists("repo", "19.1.7", "fortran.tar.gz")
    ).rejects.toThrow(
      'Requested version "19.1.7" does not exist (no release for llvmorg-19.1.7 in repo).'
    );
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it("throws error if asset is missing in existing release", async () => {
    const mockFetch = global.fetch as jest.Mock;
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        assets: [{ name: "other.zip" }],
      }),
    });

    await expect(
      verifyAssetExists("repo", "19.1.7", "fortran.tar.gz")
    ).rejects.toThrow(
      'Release llvmorg-19.1.7 in repo exists but has no asset "fortran.tar.gz".'
    );
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it("retries on network error and succeeds", async () => {
    const mockFetch = global.fetch as jest.Mock;
    mockFetch
      .mockResolvedValueOnce({
        ok: false,
        status: 503,
        statusText: "Service Unavailable",
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          assets: [{ name: "fortran.tar.gz" }],
        }),
      });

    const promise = verifyAssetExists("repo", "19.1.7", "fortran.tar.gz");
    
    await Promise.resolve();
    await Promise.resolve();

    await jest.advanceTimersByTimeAsync(4000);

    await expect(promise).resolves.not.toThrow();
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it("retries on timeout and succeeds", async () => {
    const mockFetch = global.fetch as jest.Mock;
    
    mockFetch.mockImplementationOnce((_url, options) => new Promise((_resolve, reject) => {
      if (options.signal) {
        options.signal.addEventListener("abort", () => {
          const error = new Error("The operation was aborted");
          error.name = "AbortError";
          reject(error);
        });
      }
    }));
    
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        assets: [{ name: "fortran.tar.gz" }],
      }),
    });

    const promise = verifyAssetExists("repo", "19.1.7", "fortran.tar.gz");

    await Promise.resolve();
    await Promise.resolve();

    await jest.advanceTimersByTimeAsync(5000);
    
    await Promise.resolve();
    await Promise.resolve();

    await jest.advanceTimersByTimeAsync(4000);

    await expect(promise).resolves.not.toThrow();
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it("respects custom tagFromPatch", async () => {
    const mockFetch = global.fetch as jest.Mock;
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        assets: [{ name: "fortran.tar.gz" }],
      }),
    });

    await verifyAssetExists(
      "repo",
      "1.2.3",
      "fortran.tar.gz",
      (p) => `v${p}`
    );
    
    expect(mockFetch).toHaveBeenCalledWith(
      "https://api.github.com/repos/repo/releases/tags/v1.2.3",
      expect.any(Object)
    );
  });
});

// ===========================================================================
// Year-version coercion: ambiguous bare numbers are rejected, not recovered.
//
// GitHub Actions coerces an unquoted `version: 2024.0` YAML scalar to the bare
// string "2024", which is ambiguous ("2024.0" vs "latest in 2024"). Rather than
// guess, the resolver rejects bare numeric versions for compilers whose
// supported tables never contain a bare integer (ifx/ifort/nvfortran/lfortran/
// aocc/armflang), pointing the user at an exact quoted table entry. gfortran and
// flang accept bare integer majors and are exempt.
// ===========================================================================

// Representative installer tables (mirrors src/installers/ifx/*).
const IFX_LINUX = [
  "2026.1",
  "2026.0",
  "2025.3",
  "2025.2",
  "2025.0",
  "2024.1",
  "2024.0",
  "2023.2.0",
  "2022.2.1",
  "2022.1.0",
  "2021.4.0",
  "2021.1.2",
] as const;

const IFX_WINDOWS: Record<
  string,
  Record<Msystem, readonly string[] | undefined>
> = {
  [Arch.X64]: {
    [Msystem.Native]: [
      "2026.1.1",
      "2026.0.0",
      "2025.0.0",
      "2024.0.2",
      "2024.0.1",
      "2023.0.0",
      "2022.2.0",
    ],
    [Msystem.UCRT64]: undefined,
    [Msystem.Clang64]: undefined,
  },
};

const IFORT_LINUX = [
  "2021.13",
  "2021.12",
  "2021.10",
  "2021.9",
  "2021.7.1",
  "2021.1.2",
  "2021.1",
] as const;

const NVFORTRAN_LINUX = ["26.1", "25.9", "25.5", "24.1", "23.1"] as const;

function ifxInputs(
  version: string,
  os: OS = OS.Linux,
  arch: Arch = Arch.X64,
): Inputs {
  return {
    ...baseInputs,
    compiler: Compiler.IFX,
    version,
    os,
    arch,
    msystem: Msystem.Native,
  };
}

function ifortInputs(version: string): Inputs {
  return {
    ...baseInputs,
    compiler: Compiler.IFort,
    version,
    os: OS.Linux,
    arch: Arch.X64,
    msystem: Msystem.Native,
  };
}

function nvfortranInputs(version: string): Inputs {
  return {
    ...baseInputs,
    compiler: Compiler.NVFortran,
    version,
    os: OS.Linux,
    arch: Arch.X64,
    msystem: Msystem.Native,
  };
}

const AMBIGUOUS_ERROR = /ambiguous and must be quoted/;

describe("year-version coercion: reject ambiguous bare numbers", () => {
  const mockedWarning = core.warning as jest.MockedFunction<typeof core.warning>;
  beforeEach(() => jest.clearAllMocks());

  it("rejects a bare year for ifx on Linux with an actionable error", () => {
    const inputs = ifxInputs("2024", OS.Linux);
    expect(() =>
      resolveVersion(inputs, { [Arch.X64]: IFX_LINUX, [Arch.ARM64]: undefined }),
    ).toThrow(AMBIGUOUS_ERROR);
    // The error must NOT be the generic "is not supported" fallthrough.
    expect(() =>
      resolveVersion(inputs, { [Arch.X64]: IFX_LINUX, [Arch.ARM64]: undefined }),
    ).not.toThrow(/is not supported/);
  });

  it("rejects a bare year for ifx on Windows", () => {
    const inputs = ifxInputs("2024", OS.Windows);
    expect(() =>
      resolveWindowsVersion(inputs, IFX_WINDOWS, {
        resolveMinorToLatestPatch: true,
      }),
    ).toThrow(AMBIGUOUS_ERROR);
  });

  it.each(["2024", "2025", "2026", "2021", "2030"])(
    "rejects every bare ifx year %s without silent resolution",
    (year) => {
      const inputs = ifxInputs(year, OS.Linux);
      expect(() =>
        resolveVersion(inputs, {
          [Arch.X64]: IFX_LINUX,
          [Arch.ARM64]: undefined,
        }),
      ).toThrow(AMBIGUOUS_ERROR);
    },
  );

  it("rejects a bare year for ifort on Linux (ifort has no bare-integer releases)", () => {
    expect(() =>
      resolveVersion(ifortInputs("2021"), {
        [Arch.X64]: IFORT_LINUX,
        [Arch.ARM64]: undefined,
      }),
    ).toThrow(AMBIGUOUS_ERROR);
  });

  it("rejects a bare number for nvfortran (e.g. a coerced '26.0' -> '26')", () => {
    expect(() =>
      resolveVersion(nvfortranInputs("26"), {
        [Arch.X64]: NVFORTRAN_LINUX,
        [Arch.ARM64]: undefined,
      }),
    ).toThrow(AMBIGUOUS_ERROR);
  });

  it("does NOT reject bare numbers for gfortran (bare integers are valid majors)", () => {
    const inputs = {
      ...baseInputs,
      compiler: Compiler.GFortran,
      version: "14",
    };
    expect(
      resolveVersion(inputs, {
        [Arch.X64]: ["16", "15", "14", "13"],
        [Arch.ARM64]: ["15", "14", "13"],
      }),
    ).toBe("14");
    expect(mockedWarning).not.toHaveBeenCalled();
  });

  it("still gives gfortran a generic (non-ambiguity) error for a bare but unsupported integer", () => {
    const inputs = {
      ...baseInputs,
      compiler: Compiler.GFortran,
      version: "99",
    };
    expect(() =>
      resolveVersion(inputs, {
        [Arch.X64]: ["16", "15", "14", "13"],
        [Arch.ARM64]: ["15", "14", "13"],
      }),
    ).toThrow(/gfortran 99 is not supported/);
    // gfortran is exempt, so the ambiguity branch must NOT fire.
    expect(() =>
      resolveVersion(inputs, {
        [Arch.X64]: ["16", "15", "14", "13"],
        [Arch.ARM64]: ["15", "14", "13"],
      }),
    ).not.toThrow(AMBIGUOUS_ERROR);
  });

  it("accepts quoted year.0 versions unchanged (no error, no warning)", () => {
    const resolved = resolveVersion(ifxInputs("2024.0", OS.Linux), {
      [Arch.X64]: IFX_LINUX,
      [Arch.ARM64]: undefined,
    });
    expect(resolved).toBe("2024.0");
    expect(mockedWarning).not.toHaveBeenCalled();
  });

  it("accepts 2-part year versions that round-trip in YAML (no coercion)", () => {
    // "2024.1" survives unquoted -> it is a real table entry and must resolve.
    expect(
      resolveVersion(ifxInputs("2024.1", OS.Linux), {
        [Arch.X64]: IFX_LINUX,
        [Arch.ARM64]: undefined,
      }),
    ).toBe("2024.1");
    expect(mockedWarning).not.toHaveBeenCalled();
  });

  it("leaves the unrecoverable 2021.10 -> '2021.1' collision to the existing patch-prefix fallthrough", () => {
    // "2021.1" (coerced from 2021.10) is NOT a bare integer, so the ambiguity
    // guard does not fire; resolveMinorToLatestPatch (which ifx uses) expands it.
    // This is the documented, unrecoverable case addressed by quoting.
    expect(
      resolveVersion(
        ifxInputs("2021.1", OS.Linux),
        {
          [Arch.X64]: IFX_LINUX,
          [Arch.ARM64]: undefined,
        },
        { resolveMinorToLatestPatch: true },
      ),
    ).toBe("2021.1.2");
  });

  it("ambiguity error message names the compiler, the bad input, and the gfortran/flang exemption", () => {
    let msg = "";
    try {
      resolveVersion(ifxInputs("2024", OS.Linux), {
        [Arch.X64]: IFX_LINUX,
        [Arch.ARM64]: undefined,
      });
    } catch (e) {
      msg = (e as Error).message;
    }
    expect(msg).toContain("ifx");
    expect(msg).toContain('"2024"');
    expect(msg).toContain("ambiguous");
    expect(msg).toContain("quoted exactly as listed");
    // The suggested examples are drawn from the real table, not hardcoded.
    expect(msg).toContain('"2026.1"');
    expect(msg).toContain('"2026.0"');
    expect(msg).toContain("gfortran and flang accept bare");
    expect(msg).toContain("Supported versions");
  });

  it("advocates real table entries in the error, not year-shaped examples (lfortran)", () => {
    const inputs = {
      ...baseInputs,
      compiler: Compiler.LFortran,
      version: "0",
    };
    let msg = "";
    try {
      resolveVersion(inputs, {
        [Arch.X64]: ["0.64.0", "0.63.0"],
        [Arch.ARM64]: undefined,
      });
    } catch (e) {
      msg = (e as Error).message;
    }
    expect(msg).toMatch(AMBIGUOUS_ERROR);
    expect(msg).toContain('"0.64.0"');
    expect(msg).not.toContain("2026");
  });

  it("rejects a bare number for aocc (aocc uses dotted minor releases, never bare integers)", () => {
    const inputs = {
      ...baseInputs,
      compiler: Compiler.AOCC,
      version: "5",
    };
    expect(() =>
      resolveVersion(
        inputs,
        { [Arch.X64]: ["5.2", "5.1", "5.0"], [Arch.ARM64]: undefined },
        { stripPatchZero: true },
      ),
    ).toThrow(AMBIGUOUS_ERROR);
  });
});
