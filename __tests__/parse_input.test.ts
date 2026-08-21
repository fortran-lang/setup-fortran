import * as core from "@actions/core";
import * as os from "os";
import { parseInputs } from "../src/parse_inputs";
import { installIFX } from "../src/installers/ifx";
import { Compiler, OS, Arch, Msystem, LATEST } from "../src/types";

jest.mock("@actions/core");
jest.mock("os");

describe("parseInputs", () => {
  const mockedGetInput = core.getInput as jest.MockedFunction<
    typeof core.getInput
  >;
  const mockedGetBooleanInput = core.getBooleanInput as jest.MockedFunction<
    typeof core.getBooleanInput
  >;
  const mockedArch = os.arch as jest.MockedFunction<typeof os.arch>;
  const mockedRelease = os.release as jest.MockedFunction<typeof os.release>;

  let originalPlatform: string;
  let originalEnv: NodeJS.ProcessEnv;

  beforeAll(() => {
    originalPlatform = process.platform;
    originalEnv = { ...process.env };
  });

  afterAll(() => {
    Object.defineProperty(process, "platform", {
      value: originalPlatform,
    });
    process.env = originalEnv;
  });

  beforeEach(() => {
    jest.clearAllMocks();
    mockedGetInput.mockReturnValue("");
    mockedGetBooleanInput.mockImplementation((name) => {
      if (name === "update-environment") return true;
      return false;
    });
    mockedArch.mockReturnValue("x64");
    mockedRelease.mockReturnValue("5.15.0");
    delete process.env.ImageOS;
    setPlatform("linux");
  });

  function setPlatform(platform: string) {
    Object.defineProperty(process, "platform", {
      value: platform,
      configurable: true,
    });
  }

  it("returns default values when no inputs are provided", () => {
    const result = parseInputs();
    expect(result).toEqual({
      compiler: Compiler.GFortran,
      version: LATEST,
      os: OS.Linux,
      osVersion: "5.15.0",
      arch: Arch.X64,
      msystem: Msystem.Native,
      cleanupDisk: false,
      updateEnvironment: true,
    });
  });

  it("handles whitespace-only inputs by falling back to defaults where appropriate", () => {
    mockedGetInput.mockReturnValue("  ");
    const result = parseInputs();
    expect(result).toEqual({
      compiler: Compiler.GFortran,
      version: LATEST,
      os: OS.Linux,
      osVersion: "5.15.0",
      arch: Arch.X64,
      msystem: Msystem.Native,
      cleanupDisk: false,
      updateEnvironment: true,
    });
  });

  describe("compiler input", () => {
    it("parses valid compiler names case-insensitively", () => {
      mockedGetInput.mockImplementation((name) => {
        if (name === "compiler") return "  IFX  ";
        return "";
      });
      const result = parseInputs();
      expect(result.compiler).toBe(Compiler.IFX);
    });

    it.each([
      [Compiler.GFortran, "gfortran"],
      [Compiler.IFX, "ifx"],
      [Compiler.IFort, "ifort"],
      [Compiler.NVFortran, "nvfortran"],
      [Compiler.AOCC, "aocc"],
      [Compiler.Flang, "flang"],
      [Compiler.LFortran, "lfortran"],
      [Compiler.ArmFlang, "armflang"],
    ])("parses %s compiler", (expected, input) => {
      mockedGetInput.mockImplementation((name) => {
        if (name === "compiler") return input;
        return "";
      });
      expect(parseInputs().compiler).toBe(expected);
    });

    it.each([
      ["gcc", Compiler.GFortran],
      ["intel", Compiler.IFX],
      ["intel-classic", Compiler.IFort],
      ["nvidia-hpc", Compiler.NVFortran],
    ])("maps the %s alias to %s", (input, expected) => {
      mockedGetInput.mockImplementation((name) => {
        if (name === "compiler") return input;
        return "";
      });
      expect(parseInputs().compiler).toBe(expected);
    });

    it.each([
      ["gcc", "gfortran"],
      ["intel", "ifx"],
      ["intel-classic", "ifort"],
      ["nvidia-hpc", "nvfortran"],
    ])(
      "produces identical inputs for alias %s and canonical name %s",
      (alias, canonical) => {
        let compilerInput = alias;
        mockedGetInput.mockImplementation((name) => {
          if (name === "compiler") return compilerInput;
          if (name === "version") return "2025.2";
          return "";
        });

        const aliasInputs = parseInputs();
        compilerInput = canonical;
        const canonicalInputs = parseInputs();

        expect(aliasInputs).toEqual(canonicalInputs);
      },
    );

    it("maps aliases case-insensitively and ignores surrounding whitespace", () => {
      mockedGetInput.mockImplementation((name) => {
        if (name === "compiler") return "  InTeL-ClAsSiC  ";
        return "";
      });
      expect(parseInputs().compiler).toBe(Compiler.IFort);
    });

    it.each([
      ["gcc", Compiler.GFortran],
      ["intel", Compiler.IFX],
      ["intel-classic", Compiler.IFort],
      ["nvidia-hpc", Compiler.NVFortran],
    ])("warns that the %s alias is deprecated in favor of %s", (alias, canonical) => {
      mockedGetInput.mockImplementation((name) => {
        if (name === "compiler") return alias;
        return "";
      });
      parseInputs();
      expect(core.warning).toHaveBeenCalledWith(
        `The compiler selector "${alias}" is deprecated; please use "${canonical}" instead.`,
      );
    });

    it("warns for aliases case-insensitively and with surrounding whitespace", () => {
      mockedGetInput.mockImplementation((name) => {
        if (name === "compiler") return "  InTeL-ClAsSiC  ";
        return "";
      });
      parseInputs();
      expect(core.warning).toHaveBeenCalledWith(
        'The compiler selector "intel-classic" is deprecated; please use "ifort" instead.',
      );
    });

    it("does not warn when a canonical compiler name is used", () => {
      mockedGetInput.mockImplementation((name) => {
        if (name === "compiler") return "ifx";
        return "";
      });
      parseInputs();
      expect(core.warning).not.toHaveBeenCalled();
    });

    it("does not warn when the default compiler is used", () => {
      mockedGetInput.mockReturnValue("");
      parseInputs();
      expect(core.warning).not.toHaveBeenCalled();
    });

    it("maps intel to ifx on macOS and retains ifx unsupported-platform behavior", async () => {
      setPlatform("darwin");
      mockedGetInput.mockImplementation((name) => {
        if (name === "compiler") return "intel";
        return "";
      });

      const inputs = parseInputs();
      expect(inputs.compiler).toBe(Compiler.IFX);
      await expect(installIFX(inputs)).rejects.toThrow(
        "ifx is not supported on macOS.",
      );
    });

    it("throws error for unknown compiler", () => {
      mockedGetInput.mockImplementation((name) => {
        if (name === "compiler") return "unknown-compiler";
        return "";
      });
      expect(() => parseInputs()).toThrow(
        'Unknown compiler "unknown-compiler". Valid options: gfortran, ifx, ifort, nvfortran, aocc, flang, lfortran, armflang, gcc, intel, intel-classic, nvidia-hpc',
      );
    });

    // Dedicated alias compatibility matrix: every alias must map to its
    // canonical compiler deterministically on ALL OS families, regardless of
    // whether the canonical compiler is ultimately installable on that platform.
    // The canonical integration workflows alone cannot catch alias behavior
    // because they exercise canonical names; this matrix ensures aliases are
    // transparent substitutions at the input layer.
    describe("alias compatibility matrix across all OS families", () => {
      const ALIASES: [string, Compiler][] = [
        ["gcc", Compiler.GFortran],
        ["intel", Compiler.IFX],
        ["intel-classic", Compiler.IFort],
        ["nvidia-hpc", Compiler.NVFortran],
      ];
      const PLATFORMS: [string, OS][] = [
        ["linux", OS.Linux],
        ["darwin", OS.MacOS],
        ["win32", OS.Windows],
      ];

      it.each(ALIASES)(
        "alias '%s' maps to %s on all three OS families",
        (alias, canonical) => {
          for (const [platform, expectedOS] of PLATFORMS) {
            setPlatform(platform);
            mockedGetInput.mockImplementation((name) => {
              if (name === "compiler") return alias;
              return "";
            });

            const inputs = parseInputs();
            expect(inputs.compiler).toBe(canonical);
            expect(inputs.os).toBe(expectedOS);
          }
        },
      );

      it.each(ALIASES)(
        "alias '%s' and canonical name '%s' produce identical parsed inputs on all OS families",
        (alias, canonical) => {
          for (const [platform, expectedOS] of PLATFORMS) {
            setPlatform(platform);

            // Parse with alias
            mockedGetInput.mockImplementation((name) => {
              if (name === "compiler") return alias;
              if (name === "version") return "2025.2";
              return "";
            });
            const aliasInputs = parseInputs();

            // Parse with canonical
            mockedGetInput.mockImplementation((name) => {
              if (name === "compiler") return canonical;
              if (name === "version") return "2025.2";
              return "";
            });
            const canonicalInputs = parseInputs();

            expect(aliasInputs).toEqual(canonicalInputs);
            expect(aliasInputs.os).toBe(expectedOS);
          }
        },
      );
    });
  });

  describe("version input", () => {
    it("returns the provided version string", () => {
      mockedGetInput.mockImplementation((name) => {
        if (name === "version") return "13.2.0";
        return "";
      });
      const result = parseInputs();
      expect(result.version).toBe("13.2.0");
    });

    it("handles year-based versions like 2022.2.1", () => {
      mockedGetInput.mockImplementation((name) => {
        if (name === "version") return "2022.2.1";
        return "";
      });
      const result = parseInputs();
      expect(result.version).toBe("2022.2.1");
    });

    it("handles short year-based versions like 2025.2", () => {
      mockedGetInput.mockImplementation((name) => {
        if (name === "version") return "2025.2";
        return "";
      });
      const result = parseInputs();
      expect(result.version).toBe("2025.2");
    });

    it("trims whitespace from version strings", () => {
      mockedGetInput.mockImplementation((name) => {
        if (name === "version") return "  14.1  ";
        return "";
      });
      const result = parseInputs();
      expect(result.version).toBe("14.1");
    });

    it("accepts the literal string 'latest' and resolves to LATEST", () => {
      mockedGetInput.mockImplementation((name) => {
        if (name === "version") return "latest";
        return "";
      });
      const result = parseInputs();
      expect(result.version).toBe(LATEST);
    });
  });

  describe("mixed inputs", () => {
    it("correctly merges provided inputs with defaults", () => {
      mockedGetInput.mockImplementation((name) => {
        if (name === "compiler") return "ifort";
        // version is missing, should be default
        return "";
      });
      const result = parseInputs();
      expect(result).toMatchObject({
        compiler: Compiler.IFort,
        version: LATEST,
        os: OS.Linux,
      });
    });
  });

  describe("defaults across all OS families", () => {
    const PLATFORMS: [string, OS][] = [
      ["linux", OS.Linux],
      ["darwin", OS.MacOS],
      ["win32", OS.Windows],
    ];

    it.each(PLATFORMS)(
      "defaults compiler to gfortran, version to LATEST, and updateEnvironment to true on %s",
      (platform, expectedOS) => {
        setPlatform(platform);
        const result = parseInputs();
        expect(result).toMatchObject({
          compiler: Compiler.GFortran,
          version: LATEST,
          os: expectedOS,
          updateEnvironment: true,
        });
      },
    );

    it.each(PLATFORMS)(
      "update-environment=false is parsed on %s",
      (platform) => {
        setPlatform(platform);
        mockedGetBooleanInput.mockImplementation((name) => {
          if (name === "update-environment") return false;
          return false;
        });
        const result = parseInputs();
        expect(result.updateEnvironment).toBe(false);
      },
    );

    it.each(PLATFORMS)(
      "omitted compiler defaults to gfortran and omitted version defaults to LATEST on %s",
      (platform) => {
        setPlatform(platform);
        const result = parseInputs();
        expect(result.compiler).toBe(Compiler.GFortran);
        expect(result.version).toBe(LATEST);
      },
    );
  });

  describe("msystem input", () => {
    it("parses valid msystem names case-insensitively", () => {
      mockedGetInput.mockImplementation((name) => {
        if (name === "msystem") return " UCRT64 ";
        return "";
      });
      const result = parseInputs();
      expect(result.msystem).toBe(Msystem.UCRT64);
    });

    it("throws error for unknown msystem", () => {
      mockedGetInput.mockImplementation((name) => {
        if (name === "msystem") return "msys"; // incomplete
        return "";
      });
      expect(() => parseInputs()).toThrow(
        'Unknown msystem "msys". Valid options: native, ucrt64',
      );
    });
  });

  describe("update-environment input", () => {
    it("defaults to true when omitted", () => {
      // getBooleanInput is mocked, so this simulates the action.yml default
      // being applied; it does not exercise the real parsing path.
      mockedGetBooleanInput.mockImplementation((name) => {
        if (name === "update-environment") return true;
        return false;
      });
      const result = parseInputs();
      expect(result.updateEnvironment).toBe(true);
    });

    it("parses true", () => {
      mockedGetBooleanInput.mockImplementation((name) => {
        if (name === "update-environment") return true;
        return false;
      });
      const result = parseInputs();
      expect(result.updateEnvironment).toBe(true);
    });

    it("parses false", () => {
      mockedGetBooleanInput.mockImplementation((name) => {
        if (name === "update-environment") return false;
        return false;
      });
      const result = parseInputs();
      expect(result.updateEnvironment).toBe(false);
    });

    it("throws for invalid values", () => {
      mockedGetBooleanInput.mockImplementation((name) => {
        if (name === "update-environment") {
          throw new Error(
            'Input "update-environment" must be true or false; received "maybe".',
          );
        }
        return false;
      });
      expect(() => parseInputs()).toThrow(
        'Input "update-environment" must be true or false; received "maybe".',
      );
    });
  });

  describe("OS detection", () => {
    it("detects Linux", () => {
      setPlatform("linux");
      expect(parseInputs().os).toBe(OS.Linux);
    });

    it("detects MacOS", () => {
      setPlatform("darwin");
      expect(parseInputs().os).toBe(OS.MacOS);
    });

    it("detects Windows", () => {
      setPlatform("win32");
      expect(parseInputs().os).toBe(OS.Windows);
    });

    it("throws for unsupported OS", () => {
      setPlatform("freebsd");
      expect(() => parseInputs()).toThrow(
        'Not implemented yet: "freebsd" case',
      );
    });
  });

  describe("Architecture detection", () => {
    it("detects x64", () => {
      mockedArch.mockReturnValue("x64");
      expect(parseInputs().arch).toBe(Arch.X64);
    });

    it("detects arm64", () => {
      mockedArch.mockReturnValue("arm64");
      expect(parseInputs().arch).toBe(Arch.ARM64);
    });

    it("throws for unsupported architecture", () => {
      mockedArch.mockReturnValue("arm" as any);
      expect(() => parseInputs()).toThrow('Not implemented yet: "arm" case');
    });
  });

  describe("osVersion population", () => {
    it("uses ImageOS environment variable if available", () => {
      process.env.ImageOS = "ubuntu22";
      expect(parseInputs().osVersion).toBe("ubuntu22");
    });

    it("falls back to os.release() if ImageOS is not set", () => {
      delete process.env.ImageOS;
      mockedRelease.mockReturnValue("22.04.1-Ubuntu");
      expect(parseInputs().osVersion).toBe("22.04.1-Ubuntu");
    });
  });
});
