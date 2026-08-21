import * as core from "@actions/core";
import { execFileSync } from "child_process";
import { mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { persistMsvcBinForBash } from "../src/setup_msvc";

jest.mock("@actions/core");

describe("persistMsvcBinForBash shell integration", () => {
  let testDir: string;
  const originalRunnerTemp = process.env.RUNNER_TEMP;
  const originalBashEnv = process.env.BASH_ENV;

  beforeEach(() => {
    jest.clearAllMocks();
    testDir = mkdtempSync(join(tmpdir(), "setup-fortran-bash-env-"));
    process.env.RUNNER_TEMP = testDir;
    delete process.env.BASH_ENV;
  });

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true });
  });

  afterAll(() => {
    if (originalRunnerTemp === undefined) delete process.env.RUNNER_TEMP;
    else process.env.RUNNER_TEMP = originalRunnerTemp;

    if (originalBashEnv === undefined) delete process.env.BASH_ENV;
    else process.env.BASH_ENV = originalBashEnv;
  });

  it("prepends the tool directory in a fresh non-interactive Bash", () => {
    const msvcBin = "/opt/MSVC's tools/bin";
    const bashEnv = persistMsvcBinForBash(msvcBin);

    const firstPathEntry = execFileSync(
      "bash",
      ["--noprofile", "--norc", "-c", 'printf "%s" "${PATH%%:*}"'],
      {
        encoding: "utf8",
        env: { ...process.env, BASH_ENV: bashEnv },
      },
    );

    expect(firstPathEntry).toBe(msvcBin);
    expect(core.exportVariable).toHaveBeenCalledWith("BASH_ENV", bashEnv);
  });

  it("sources a pre-existing Bash environment before adding the tool path", () => {
    const previousBashEnv = join(testDir, "existing env.sh");
    writeFileSync(
      previousBashEnv,
      "export EXISTING_BASH_ENV_WAS_SOURCED=yes\n",
    );
    process.env.BASH_ENV = previousBashEnv;

    const bashEnv = persistMsvcBinForBash("/opt/msvc/bin");
    const result = execFileSync(
      "bash",
      [
        "--noprofile",
        "--norc",
        "-c",
        'printf "%s|%s" "$EXISTING_BASH_ENV_WAS_SOURCED" "${PATH%%:*}"',
      ],
      {
        encoding: "utf8",
        env: { ...process.env, BASH_ENV: bashEnv },
      },
    );

    expect(result).toBe("yes|/opt/msvc/bin");
  });
});
