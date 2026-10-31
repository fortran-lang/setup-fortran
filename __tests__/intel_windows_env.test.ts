import * as core from "@actions/core";
import * as exec from "@actions/exec";
import * as fs from "fs";
import { captureIntelWindowsEnvironment } from "../src/intel_windows_env";

jest.mock("@actions/core");
jest.mock("@actions/exec");
jest.mock("fs", () => ({
  ...jest.requireActual("fs"),
  writeFileSync: jest.fn(),
}));

describe("captureIntelWindowsEnvironment", () => {
  const mockedExec = exec.exec as jest.MockedFunction<typeof exec.exec>;
  const mockedFs = fs as jest.Mocked<typeof fs>;
  const mockedExportVariable = core.exportVariable as jest.MockedFunction<
    typeof core.exportVariable
  >;
  const mockedAddPath = core.addPath as jest.MockedFunction<
    typeof core.addPath
  >;
  const mockedWarning = core.warning as jest.MockedFunction<
    typeof core.warning
  >;

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("writes a batch file that calls vcvars64.bat then the given setvars script", async () => {
    mockedExec.mockResolvedValue(0);

    await captureIntelWindowsEnvironment(
      "C:\\Program Files (x86)\\Intel\\oneAPI\\setvars.bat",
      "setvars_and_dump.bat",
    );

    expect(mockedFs.writeFileSync).toHaveBeenCalledWith(
      expect.stringContaining("setvars_and_dump.bat"),
      expect.stringContaining(
        'call "C:\\Program Files (x86)\\Intel\\oneAPI\\setvars.bat" --force',
      ),
    );
    expect(mockedFs.writeFileSync).toHaveBeenCalledWith(
      expect.anything(),
      expect.stringContaining("vcvars64.bat"),
    );
  });

  it("exports matched keys, filters git\\usr\\bin out of PATH, and adds the MSVC and Intel bin dirs", async () => {
    const msvcBin =
      "C:\\Program Files\\Microsoft Visual Studio\\2022\\Enterprise\\VC\\Tools\\MSVC\\14.40.33807\\bin\\Hostx64\\x64";
    const intelBin =
      "C:\\Program Files (x86)\\Intel\\oneAPI\\compiler\\latest\\windows\\bin";

    mockedExec.mockImplementation(async (commandLine, args, options) => {
      options?.listeners?.stdout?.(
        Buffer.from(
          [
            `PATH=C:\\intel\\bin;C:\\Git\\usr\\bin;${msvcBin};${intelBin};C:\\other`,
            "ONEAPI_ROOT=C:\\intel",
            "UNRELATED=skip-me",
          ].join("\n"),
        ),
      );
      return 0;
    });

    await captureIntelWindowsEnvironment("C:\\setvars.bat", "dump.bat");

    expect(mockedExportVariable).toHaveBeenCalledWith(
      "PATH",
      `C:\\intel\\bin;${msvcBin};${intelBin};C:\\other`,
    );
    expect(mockedExportVariable).toHaveBeenCalledWith(
      "ONEAPI_ROOT",
      "C:\\intel",
    );
    expect(mockedExportVariable).not.toHaveBeenCalledWith(
      "UNRELATED",
      expect.anything(),
    );

    // The exported PATH is only the baseline; earlier addPath entries are
    // re-prepended over it, so both bin dirs have to be addPath'ed as well.
    expect(mockedAddPath).toHaveBeenCalledWith(msvcBin);
    expect(mockedAddPath).toHaveBeenCalledWith(intelBin);
  });

  describe("PATH length warning", () => {
    const pathOfLength = (length: number) => `C:\\${"a".repeat(length - 3)}`;

    it.each([
      [4096, false],
      [4097, true],
    ])(
      "with an exported PATH of %i characters, warns: %s",
      async (length, warns) => {
        mockedExec.mockImplementation(async (commandLine, args, options) => {
          options?.listeners?.stdout?.(
            Buffer.from(`PATH=${pathOfLength(length)}`),
          );
          return 0;
        });

        await captureIntelWindowsEnvironment("C:\\setvars.bat", "dump.bat");

        const warned = mockedWarning.mock.calls.some(([message]) =>
          String(message).includes(
            "Do not re-run setvars.bat or vcvarsall.bat",
          ),
        );
        expect(warned).toBe(warns);
      },
    );

    it("reports the PATH length and the cmd.exe error text", async () => {
      mockedExec.mockImplementation(async (commandLine, args, options) => {
        options?.listeners?.stdout?.(Buffer.from(`PATH=${pathOfLength(5000)}`));
        return 0;
      });

      await captureIntelWindowsEnvironment("C:\\setvars.bat", "dump.bat");

      expect(mockedWarning).toHaveBeenCalledWith(
        expect.stringContaining("PATH is 5000 characters"),
      );
      expect(mockedWarning).toHaveBeenCalledWith(
        expect.stringContaining("The input line is too long"),
      );
    });
  });
});
