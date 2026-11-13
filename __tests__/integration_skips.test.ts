import {
  parseBundledClangMajor,
  windowsFlangCxxSkipReason,
  type WindowsFlangCxxContext,
} from "../src/integration_skips";

const nativeFlang = (
  overrides: Partial<WindowsFlangCxxContext> = {},
): WindowsFlangCxxContext => ({
  isWindows: true,
  isFlang: true,
  isMSYS2: false,
  bundledClangMajor: 20,
  ...overrides,
});

describe("parseBundledClangMajor", () => {
  it("reads the major from a native Windows flang-verified CXX path", () => {
    expect(
      parseBundledClangMajor(
        "C:\\hostedtoolcache\\windows\\flang-verified\\20.1.8\\arm64\\bin\\clang++.exe",
      ),
    ).toBe(20);
    expect(
      parseBundledClangMajor(
        "C:/hostedtoolcache/windows/flang-verified/23.1.0/x64/bin/clang++.exe",
      ),
    ).toBe(23);
  });

  it("returns undefined for MSYS2 and system companions", () => {
    expect(
      parseBundledClangMajor("C:\\msys64\\clangarm64\\bin\\clang++.exe"),
    ).toBeUndefined();
    expect(parseBundledClangMajor("/usr/bin/clang++")).toBeUndefined();
    expect(parseBundledClangMajor(undefined)).toBeUndefined();
  });
});

describe("windowsFlangCxxSkipReason", () => {
  it("skips the exact flang 20 windows-11-arm companion from CI", () => {
    const cxx =
      "C:\\hostedtoolcache\\windows\\flang-verified\\20.1.8\\arm64\\bin\\clang++.exe";
    expect(
      windowsFlangCxxSkipReason(
        nativeFlang({ bundledClangMajor: parseBundledClangMajor(cxx) }),
      ),
    ).toContain("Clang 22+");
  });

  it("skips native Windows flang whose bundled clang is older than 22", () => {
    expect(
      windowsFlangCxxSkipReason(nativeFlang({ bundledClangMajor: 21 })),
    ).toContain("Clang 22+");
  });

  it("does not skip clang 22 or newer", () => {
    expect(
      windowsFlangCxxSkipReason(nativeFlang({ bundledClangMajor: 22 })),
    ).toBeUndefined();
    expect(
      windowsFlangCxxSkipReason(nativeFlang({ bundledClangMajor: 23 })),
    ).toBeUndefined();
  });

  it("does not skip MSYS2, other platforms, other compilers, or unknown companions", () => {
    expect(
      windowsFlangCxxSkipReason(nativeFlang({ isMSYS2: true })),
    ).toBeUndefined();
    expect(
      windowsFlangCxxSkipReason(nativeFlang({ isWindows: false })),
    ).toBeUndefined();
    expect(
      windowsFlangCxxSkipReason(nativeFlang({ isFlang: false })),
    ).toBeUndefined();
    expect(
      windowsFlangCxxSkipReason(nativeFlang({ bundledClangMajor: undefined })),
    ).toBeUndefined();
  });
});
