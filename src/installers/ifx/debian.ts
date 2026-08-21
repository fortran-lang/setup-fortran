import * as core from "@actions/core";
import * as exec from "@actions/exec";
import * as cache from "@actions/cache";
import * as fs from "fs";
import { Arch, type InstallationResult, type Inputs } from "../../types";
import { resolveVersion } from "../../resolve_version";
import {
  saveCompilerCache,
  validateRestoredCompilerCache,
} from "../../cache_validation";

const SUPPORTED_VERSIONS = {
  [Arch.X64]: [
    "2026.1",
    "2026.0",
    "2025.3",
    "2025.2",
    "2025.1",
    "2025.0",
    "2024.2",
    "2024.1",
    "2024.0",
    "2023.2.4",
    "2023.2.3",
    "2023.2.2",
    "2023.2.1",
    "2023.2.0",
    "2023.1.0",
    "2023.0.0",
    "2022.2.1",
    "2022.2.0",
    "2022.1.0",
    "2022.0.2",
    "2022.0.1",
    "2021.4.0",
    "2021.3.0",
    "2021.2.0",
    "2021.1.2",
    "2021.1.1",
  ],
  [Arch.ARM64]: undefined,
} as const satisfies Record<Arch, readonly string[] | undefined>;

const APT_TIMEOUT_OPTS = [
  "-o",
  "Acquire::http::Timeout=30",
  "-o",
  "Acquire::http::ConnectTimeout=20",
  "-o",
  "Acquire::https::Timeout=30",
  "-o",
  "Acquire::https::ConnectTimeout=20",
  "-o",
  "Acquire::Retries=0",
];

const WGET_TIMEOUT_ARGS = ["--timeout=30", "--connect-timeout=20", "--tries=3"];

export async function installDebian(
  inputs: Inputs,
): Promise<InstallationResult> {
  const version = resolveVersion(inputs, SUPPORTED_VERSIONS, {
    resolveMinorToLatestPatch: true,
  });
  core.info(`Installing ifx ${version} on Linux (${inputs.arch})...`);

  const ONEAPI_ROOT = "/opt/intel/oneapi";
  const cacheKey = `oneapi-ifx-validated-v1-${inputs.arch}-${version}`;
  const cachePaths = [ONEAPI_ROOT];

  if (!fs.existsSync(ONEAPI_ROOT)) {
    fs.mkdirSync(ONEAPI_ROOT, { recursive: true });
  }

  const cacheHit = await cache.restoreCache(cachePaths, cacheKey);
  const setVarsScript = `${ONEAPI_ROOT}/setvars.sh`;
  const cacheValid = cacheHit
    ? await validateRestoredCompilerCache(
        `ifx ${version}`,
        [setVarsScript],
        "bash",
        [
          "-c",
          `source "${setVarsScript}" --force && ifx --version && icx --version && icpx --version`,
        ],
      )
    : false;

  if (!cacheValid) {
    if (cacheHit) {
      await exec.exec("sudo", ["rm", "-rf", ONEAPI_ROOT]);
      await exec.exec("sudo", ["mkdir", "-p", ONEAPI_ROOT]);
    }
    core.info("Adding Intel oneAPI apt repository...");
    await exec.exec("bash", [
      "-c",
      [
        `wget ${WGET_TIMEOUT_ARGS.join(" ")} -O- https://apt.repos.intel.com/intel-gpg-keys/GPG-PUB-KEY-INTEL-SW-PRODUCTS.PUB`,
        `| gpg --dearmor`,
        `| sudo tee /usr/share/keyrings/oneapi-archive-keyring.gpg > /dev/null`,
      ].join(" "),
    ]);
    await exec.exec("bash", [
      "-c",
      `echo "deb [signed-by=/usr/share/keyrings/oneapi-archive-keyring.gpg] https://apt.repos.intel.com/oneapi all main" | sudo tee /etc/apt/sources.list.d/oneAPI.list`,
    ]);

    await aptGetUpdateWithRetry();

    const fortranPkg = `intel-oneapi-compiler-fortran-${version}`;
    const LEGACY_CPP_PKG_VERSIONS = ["2021", "2022", "2023"];
    const cppPkgBase = LEGACY_CPP_PKG_VERSIONS.some((y) =>
      version.startsWith(y),
    )
      ? "intel-oneapi-compiler-dpcpp-cpp-and-cpp-classic"
      : "intel-oneapi-compiler-dpcpp-cpp";
    const cppPkg = `${cppPkgBase}-${version}`;

    core.info(`Installing apt packages ${fortranPkg} and ${cppPkg}...`);

    await aptInstallWithRetry([
      "install",
      "-y",
      "--no-install-recommends",
      ...APT_TIMEOUT_OPTS,
      fortranPkg,
      cppPkg,
    ]);

    await saveCompilerCache(cachePaths, cacheKey);
  } else {
    core.info(`Cache hit for ${cacheKey}, skipping installation...`);
  }

  core.info(`Sourcing ${setVarsScript} and exporting environment...`);

  let envOutput = "";
  await exec.exec("bash", ["-c", `source "${setVarsScript}" --force && env`], {
    listeners: {
      stdout: (data: Buffer) => {
        envOutput += data.toString();
      },
    },
  });

  for (const line of envOutput.split("\n")) {
    const eqIdx = line.indexOf("=");
    if (eqIdx === -1) continue;
    const key = line.substring(0, eqIdx);
    const val = line.substring(eqIdx + 1);

    if (
      /^(PATH|LD_LIBRARY_PATH|.*INTEL.*|.*ONEAPI.*|.*MKL.*|MKLROOT|CMPLR_ROOT)$/i.test(
        key,
      )
    ) {
      core.exportVariable(key, val);
      process.env[key] = val; // Keeps the Node process environment synchronized
    }
  }

  const resolvedVersion = await resolveInstalledVersion();
  core.info(`ifx ${resolvedVersion} installed successfully.`);
  return {
    version: resolvedVersion,
    fc: "ifx",
    cc: "icx",
    cxx: "icpx",
  };
}

async function aptInstallWithRetry(
  args: string[],
  maxAttempts = 3,
): Promise<void> {
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const exitCode = await exec.exec(
      "sudo",
      [
        "timeout",
        "--signal=TERM",
        "--kill-after=30s",
        "15m",
        "apt-get",
        ...args,
      ],
      {
        ignoreReturnCode: true,
      },
    );

    if (exitCode === 0) return;

    if (attempt === maxAttempts) {
      throw new Error(
        `apt-get install failed after ${maxAttempts.toString()} attempts with exit code ${exitCode.toString()}.`,
      );
    }

    core.warning(
      `apt-get install failed (attempt ${attempt.toString()}/${maxAttempts.toString()}). Attempting to repair dependencies...`,
    );

    await exec.exec(
      "sudo",
      [
        "timeout",
        "--signal=TERM",
        "--kill-after=30s",
        "10m",
        "apt-get",
        "--fix-broken",
        "install",
        "-y",
        ...APT_TIMEOUT_OPTS,
      ],
      {
        ignoreReturnCode: true,
      },
    );

    await new Promise((resolve) => setTimeout(resolve, 15_000));
  }
}

// `apt-get update` hits live mirrors and is the most common stall point; a
// non-zero exit (e.g. a flaky repo / stale signature) should be tolerated with
// a couple of bounded retries rather than stalling the whole job. Total worst
// case is bounded by APT_TIMEOUT_OPTS' ConnectTimeout plus the backoff sleeps.
async function aptGetUpdateWithRetry(maxAttempts = 3): Promise<void> {
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      await exec.exec("sudo", [
        "timeout",
        "--signal=TERM",
        "--kill-after=10s",
        "5m",
        "apt-get",
        "update",
        "-y",
        ...APT_TIMEOUT_OPTS,
      ]);
      return;
    } catch (err) {
      if (attempt === maxAttempts) throw err;
      core.warning(
        `apt-get update failed (attempt ${attempt.toString()}/${maxAttempts.toString()}), retrying in ${(attempt * 10).toString()}s...`,
      );
      await new Promise((res) => setTimeout(res, attempt * 10_000));
    }
  }
}

async function resolveInstalledVersion(): Promise<string> {
  let output = "";
  await exec.exec("ifx", ["--version"], {
    listeners: {
      stdout: (data: Buffer) => {
        output += data.toString();
      },
    },
  });
  return output.trim();
}
