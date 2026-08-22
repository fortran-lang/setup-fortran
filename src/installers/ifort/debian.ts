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

// Make sure the versions are always in descending order. The first one will be
// used as the default if no version was specified by the user.
//
// Mapping: https://www.intel.com/content/www/us/en/developer/articles/tool/compilers-redistributable-libraries-by-version.html
const IFORT_BUNDLES = [
  { ifort: "2021.13", bundle: "2024.2" },
  { ifort: "2021.12", bundle: "2024.1" },
  { ifort: "2021.11", bundle: "2024.0" },
  { ifort: "2021.10", bundle: "2023.2.4" },
  { ifort: "2021.9", bundle: "2023.1.0" },
  { ifort: "2021.8", bundle: "2023.0.0" },
  { ifort: "2021.7.1", bundle: "2022.2.1" },
  { ifort: "2021.7", bundle: "2022.2.0" },
  { ifort: "2021.6", bundle: "2022.1.0" },
  { ifort: "2021.5", bundle: "2022.0.2" },
  { ifort: "2021.4", bundle: "2021.4.0" },
  { ifort: "2021.3", bundle: "2021.3.0" },
  { ifort: "2021.2", bundle: "2021.2.0" },
  { ifort: "2021.1.2", bundle: "2021.1.2" },
  { ifort: "2021.1", bundle: "2021.1.2" },
] as const;

const SUPPORTED_VERSIONS = {
  [Arch.X64]: IFORT_BUNDLES.map((m) => m.ifort),
  [Arch.ARM64]: undefined,
} as const satisfies Record<Arch, readonly string[] | undefined>;

const APT_TIMEOUT_OPTS: string[] = [
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
  const version = resolveVersion(inputs, SUPPORTED_VERSIONS);

  const entry = IFORT_BUNDLES.find((m) => m.ifort === version);
  if (!entry) {
    throw new Error(`Unsupported ifort version: ${version}`);
  }

  const bundle = entry.bundle;

  const ONEAPI_ROOT = "/opt/intel/oneapi";
  const ONEAPI_CACHE_PATHS = [ONEAPI_ROOT];

  if (!fs.existsSync(ONEAPI_ROOT)) {
    fs.mkdirSync(ONEAPI_ROOT, { recursive: true });
  }

  const cacheKey = `oneapi-ifort-validated-v1-${inputs.arch}-${bundle}`;
  const cacheHit = await cache.restoreCache(ONEAPI_CACHE_PATHS, cacheKey);
  const setVarsScript = `${ONEAPI_ROOT}/setvars.sh`;
  const cacheValid = cacheHit
    ? await validateRestoredCompilerCache(
        `ifort ${version}`,
        [setVarsScript],
        "bash",
        ["-c", `source "${setVarsScript}" --force && ifort --version`],
      )
    : false;

  if (!cacheValid) {
    if (cacheHit) {
      await exec.exec("sudo", ["rm", "-rf", ONEAPI_ROOT]);
      await exec.exec("sudo", ["mkdir", "-p", ONEAPI_ROOT]);
    }
    core.info("Adding Intel oneAPI apt repository...");
    await addOneApiAptRepo();
    await exec.exec("bash", [
      "-c",
      `echo "deb [signed-by=/usr/share/keyrings/oneapi-archive-keyring.gpg] https://apt.repos.intel.com/oneapi all main" | sudo tee /etc/apt/sources.list.d/oneAPI.list`,
    ]);

    await aptGetUpdateWithRetry();

    // The versioned package names follow the intel-oneapi-compiler-<component>-<version> scheme.
    // Intel oneAPI 2024+ bundles ship the LLVM-based dpcpp-cpp package, which provides
    // the icx/icpx C/C++ drivers; earlier bundles (<=2023) ship dpcpp-cpp-and-cpp-classic,
    // which also provides classic icc/icpc.
    const fortranPkg = `intel-oneapi-compiler-fortran-${bundle}`;
    const cppPkgBase = bundle.startsWith("2024")
      ? "intel-oneapi-compiler-dpcpp-cpp"
      : "intel-oneapi-compiler-dpcpp-cpp-and-cpp-classic";
    const cppPkg = `${cppPkgBase}-${bundle}`;

    core.info(`Installing apt packages ${fortranPkg} and ${cppPkg}...`);
    await aptGetInstallWithRetry([fortranPkg, cppPkg]);

    await saveCompilerCache(ONEAPI_CACHE_PATHS, cacheKey);
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
    // Only export oneAPI/Intel/PATH-related variables.
    if (
      /^(PATH|LD_LIBRARY_PATH|.*INTEL.*|.*ONEAPI.*|.*MKL.*|MKLROOT|CMPLR_ROOT)$/i.test(
        key,
      )
    ) {
      core.exportVariable(key, val);
    }
  }

  // Workaround: Intel 2024.1 moved omp_lib.mod to intel64 subdirectory
  // without updating implicit include paths (Intel regression).
  if (bundle === "2024.1") {
    const ompIncDir =
      "/opt/intel/oneapi/compiler/2024.1/opt/compiler/include/intel64";
    const existingFflags = process.env.FFLAGS ?? "";
    core.exportVariable(
      "FFLAGS",
      existingFflags ? `${existingFflags} -I${ompIncDir}` : `-I${ompIncDir}`,
    );
  }

  const resolvedVersion = await resolveInstalledVersion();
  core.info(`ifort ${resolvedVersion} installed successfully.`);
  // Intel oneAPI 2024+ bundles ship the LLVM-based C/C++ drivers (icx/icpx)
  // instead of the classic icc/icpc, which were discontinued. Earlier bundles
  // (<=2023) still provide classic icc/icpc alongside icx.
  const bundleIs2024 = bundle.startsWith("2024");
  const result = {
    version: resolvedVersion,
    fc: "ifort",
    cc: bundleIs2024 ? "icx" : "icc",
    cxx: bundleIs2024 ? "icpx" : "icpc",
  };
  return result;
}

async function addOneApiAptRepo(maxAttempts = 3): Promise<void> {
  const cmd = [
    "set -o pipefail;",
    `wget ${WGET_TIMEOUT_ARGS.join(" ")} -O- https://apt.repos.intel.com/intel-gpg-keys/GPG-PUB-KEY-INTEL-SW-PRODUCTS.PUB`,
    "| gpg --dearmor",
    "| sudo tee /usr/share/keyrings/oneapi-archive-keyring.gpg > /dev/null",
  ].join(" ");

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      await exec.exec("bash", ["-c", cmd]);
      return;
    } catch (err) {
      if (attempt === maxAttempts) throw err;
      core.warning(
        `Fetching Intel oneAPI GPG key failed (attempt ${String(attempt)}/${String(maxAttempts)}), retrying in ${(attempt * 10).toString()}s...`,
      );
      await new Promise((res) => setTimeout(res, attempt * 10_000));
    }
  }
}

async function resolveInstalledVersion(): Promise<string> {
  let output = "";
  await exec.exec("ifort", ["--version"], {
    listeners: {
      stdout: (data: Buffer) => {
        output += data.toString();
      },
    },
  });
  // ifort --version often prints a multi-line copyright header.
  // We grab just the first line which contains the actual version string.
  return output.trim().split("\n")[0];
}

async function aptGetUpdateWithRetry(maxAttempts = 3): Promise<void> {
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    let output = "";
    await exec.exec(
      "sudo",
      [
        "timeout",
        "--signal=TERM",
        "--kill-after=10s",
        "5m",
        "apt-get",
        "update",
        "-y",
        ...APT_TIMEOUT_OPTS,
      ],
      {
        listeners: {
          stdout: (data: Buffer) => {
            output += data.toString();
          },
          stderr: (data: Buffer) => {
            output += data.toString();
          },
        },
      },
    );

    const intelFetchFailed =
      output.includes("Failed to fetch") &&
      output.includes("apt.repos.intel.com");
    if (!intelFetchFailed) return;

    if (attempt === maxAttempts) {
      throw new Error("Failed to fetch the Intel oneAPI apt repository index.");
    }
    core.warning(
      `Intel oneAPI apt repository unreachable (attempt ${String(attempt)}/${String(maxAttempts)}), retrying in ${(attempt * 10).toString()}s...`,
    );
    await new Promise((res) => setTimeout(res, attempt * 10_000));
  }
}

async function aptGetInstallWithRetry(
  packages: string[],
  maxAttempts = 3,
): Promise<void> {
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      await exec.exec("sudo", [
        "timeout",
        "--signal=TERM",
        "--kill-after=30s",
        "15m",
        "apt-get",
        "install",
        "-y",
        ...APT_TIMEOUT_OPTS,
        "--no-install-recommends",
        ...packages,
      ]);
      return;
    } catch (err) {
      if (attempt === maxAttempts) throw err;
      core.warning(
        `apt-get install failed (attempt ${String(attempt)}/${String(maxAttempts)}), retrying in ${(attempt * 10).toString()}s...`,
      );
      await new Promise((res) => setTimeout(res, attempt * 10_000));
    }
  }
}
