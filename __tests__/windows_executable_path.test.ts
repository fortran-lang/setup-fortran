import { normalizeWindowsExecutablePath } from "../src/windows_executable_path";

describe("normalizeWindowsExecutablePath", () => {
  it("treats the optional executable suffix as equivalent", () => {
    expect(normalizeWindowsExecutablePath("/c/tools/link")).toBe(
      normalizeWindowsExecutablePath("/c/tools/link.exe"),
    );
  });

  it("normalizes Windows case and path separators", () => {
    expect(normalizeWindowsExecutablePath("C:\\MSVC\\Bin\\LINK.EXE")).toBe(
      "c:/msvc/bin/link",
    );
  });

  it("trims command output without changing the executable name", () => {
    expect(normalizeWindowsExecutablePath("  /c/msvc/linker.exe\r\n")).toBe(
      "/c/msvc/linker",
    );
  });
});
