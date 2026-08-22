import { miniforgeInstaller, MINIFORGE_VERSION } from "../src/miniforge";
import { Arch, OS } from "../src/types";

describe("Miniforge installer metadata", () => {
  it.each([
    [OS.Linux, Arch.X64],
    [OS.MacOS, Arch.X64],
    [OS.MacOS, Arch.ARM64],
    [OS.Windows, Arch.X64],
  ])("pins a versioned installer for %s %s", (os, arch) => {
    const installer = miniforgeInstaller(os, arch);

    expect(installer.url).toContain(`/download/${MINIFORGE_VERSION}/`);
    expect(installer.url).not.toContain("/latest/");
    expect(installer.filename).toContain(MINIFORGE_VERSION);
    expect(installer.sha256).toMatch(/^[a-f0-9]{64}$/);
  });

  it("rejects unsupported platforms", () => {
    expect(() => miniforgeInstaller(OS.Windows, Arch.ARM64)).toThrow(
      "unavailable",
    );
  });
});
