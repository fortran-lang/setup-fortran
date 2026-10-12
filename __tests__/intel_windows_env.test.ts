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

  it("exports matched keys and filters git\\usr\\bin out of PATH", async () => {
    mockedExec.mockImplementation(async (commandLine, args, options) => {
      options?.listeners?.stdout?.(
        Buffer.from(
          "PATH=C:\\intel\\bin;C:\\Git\\usr\\bin;C:\\other\nONEAPI_ROOT=C:\\intel\nUNRELATED=skip-me",
        ),
      );
      return 0;
    });

    await captureIntelWindowsEnvironment("C:\\setvars.bat", "dump.bat");

    expect(mockedExportVariable).toHaveBeenCalledWith(
      "PATH",
      "C:\\intel\\bin;C:\\other",
    );
    expect(mockedExportVariable).toHaveBeenCalledWith(
      "ONEAPI_ROOT",
      "C:\\intel",
    );
    expect(mockedExportVariable).not.toHaveBeenCalledWith(
      "UNRELATED",
      expect.anything(),
    );
  });
});
