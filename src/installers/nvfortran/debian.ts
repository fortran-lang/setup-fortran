import * as core from "@actions/core";
import * as exec from "@actions/exec";
import * as cache from "@actions/cache";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { Arch, type InstallationResult } from "../../types";
import { resolveVersion } from "../../resolve_version";
import type { Inputs } from "../../types";
import { verifySha256 } from "../../verify_download";
import {
  saveCompilerCache,
  validateRestoredCompilerCache,
} from "../../cache_validation";

const APT_NETWORK_OPTIONS = [
  "-o",
  "Acquire::ForceIPv4=true",
  "-o",
  "Acquire::Retries=0",
  "-o",
  "Acquire::http::Timeout=30",
  "-o",
  "Acquire::http::ConnectTimeout=20",
  "-o",
  "Acquire::https::Timeout=30",
  "-o",
  "Acquire::https::ConnectTimeout=20",
];

const SUPPORTED_VERSIONS = {
  [Arch.X64]: [
    "26.5",
    "26.3",
    "26.1",
    "25.11",
    "25.9",
    "25.7",
    "25.5",
    "25.3",
    "25.1",
    "24.11",
    "24.9",
    "24.7",
    "24.5",
    "24.3",
    "24.1",
    "23.11",
    "23.9",
    "23.7",
    "23.5",
    "23.3",
    "23.1",
    "22.11",
    "22.9",
    "22.7",
    "22.5",
    "22.3",
    "22.2",
    "22.1",
    "21.11",
    "21.9",
    "21.7",
    "21.5",
    "21.3",
    "21.2",
    "21.1",
    "20.11",
    "20.9",
    "20.7",
  ],
  [Arch.ARM64]: [
    "26.5",
    "26.3",
    "26.1",
    "25.11",
    "25.9",
    "25.7",
    "25.5",
    "25.3",
    "25.1",
    "24.11",
    "24.9",
    "24.7",
    "24.5",
    "24.3",
    "24.1",
    "23.11",
    "23.9",
    "23.7",
    "23.5",
    "23.3",
    "23.1",
    "22.11",
    "22.9",
    "22.7",
    "22.5",
    "22.3",
    "22.2",
    "22.1",
    "21.11",
    "21.9",
    "21.7",
    "21.5",
    "21.3",
    "21.2",
    "21.1",
    "20.11",
    "20.9",
    "20.7",
  ],
} as const satisfies Record<Arch, readonly string[]>;

const APT_ARCH: Record<Arch, "amd64" | "arm64"> = {
  [Arch.X64]: "amd64",
  [Arch.ARM64]: "arm64",
};

const NV_ARCH: Record<Arch, string> = {
  [Arch.X64]: "Linux_x86_64",
  [Arch.ARM64]: "Linux_aarch64",
};

const LEGACY_NCURSES_MAX_VERSION = "24.3";

const CUDA_VERSIONS: readonly string[] = [
  "13.2",
  "13.1",
  "13.0",
  "12.9",
  "12.8",
  "12.6",
  "12.5",
  "12.4",
  "12.3",
  "12.2",
  "12.1",
  "12.0",
  "11.8",
  "11.7",
  "11.6",
  "11.5",
  "11.4",
  "11.3",
  "11.2",
  "11.1",
  "11.0",
  "10.2",
];

const CURL_RETRY_ARGS: readonly string[] = [
  "-4",
  "-L",
  "--retry",
  "10",
  "--retry-delay",
  "5",
  "--retry-max-time",
  "300",
  "--retry-connrefused",
  "--connect-timeout",
  "30",
  "--max-time",
  "600",
  "-fsSL",
];

function compareNvhpcVersions(a: string, b: string): number {
  const [aYear, aMonth] = a.split(".").map(Number);
  const [bYear, bMonth] = b.split(".").map(Number);
  return aYear !== bYear ? aYear - bYear : aMonth - bMonth;
}

async function execWithRetry(
  command: string,
  args: string[],
  maxRetries = 5,
  delayMs = 5000,
): Promise<void> {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      await exec.exec(command, args);
      return;
    } catch (error) {
      if (attempt === maxRetries) {
        throw error;
      }
      core.warning(
        `Command "${command} ${args.join(" ")}" failed (attempt ${String(attempt)}/${String(maxRetries)}). Retrying in ${String(delayMs / 1000)}s...`,
      );
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
}

async function needsLegacyNcursesInstall(): Promise<boolean> {
  const result = await exec.getExecOutput(
    "dpkg-query",
    ["-W", "-f=${Status}", "libncursesw5", "libtinfo5"],
    { ignoreReturnCode: true },
  );
  const installedCount = (result.stdout.match(/install ok installed/g) ?? [])
    .length;
  return installedCount < 2;
}

async function installLegacyNcurses(inputs: Inputs): Promise<void> {
  core.info("Backfilling legacy ncurses5 libs...");

  const debArch = APT_ARCH[inputs.arch];
  const packages: Record<
    "amd64" | "arm64",
    Record<"libtinfo5" | "libncursesw5", { url: string; sha256: string }>
  > = {
    arm64: {
      libtinfo5: {
        url: "https://ports.ubuntu.com/ubuntu-ports/pool/universe/n/ncurses/libtinfo5_6.3-2_arm64.deb",
        sha256:
          "bff6bf29035a4bbd5aa3584bfbc86c2d414cb468a22dbd09fe601b0d39ce4e67",
      },
      libncursesw5: {
        url: "https://ports.ubuntu.com/ubuntu-ports/pool/universe/n/ncurses/libncursesw5_6.3-2_arm64.deb",
        sha256:
          "4abc034de6d0fe55032bdee039603b7a361ca1980c4f7faf781b64496ef0412a",
      },
    },
    amd64: {
      libtinfo5: {
        url: "https://security.ubuntu.com/ubuntu/pool/universe/n/ncurses/libtinfo5_6.3-2_amd64.deb",
        sha256:
          "d2597b5aec92a930cf549e1b429ad892595813e72ec7814685ea146a9fb715e5",
      },
      libncursesw5: {
        url: "https://security.ubuntu.com/ubuntu/pool/universe/n/ncurses/libncursesw5_6.3-2_amd64.deb",
        sha256:
          "2cfb737d61b4243846ba3f8d70dac7307fab355aa43cbd2cb9d023bf8d606a5c",
      },
    },
  };

  for (const [pkgName, metadata] of Object.entries(packages[debArch])) {
    const debFile = path.basename(metadata.url);
    const dest = path.join(os.tmpdir(), debFile);

    core.info(`Downloading ${pkgName}...`);
    await exec.exec("curl", [...CURL_RETRY_ARGS, "-o", dest, metadata.url]);
    await verifySha256(dest, metadata.sha256);

    core.info(`Installing ${debFile} via dpkg...`);
    await exec.exec("sudo", ["dpkg", "-i", dest]);
  }
}

async function installTarball(version: string, inputs: Inputs): Promise<void> {
  const year = `20${version.split(".")[0]}`;
  const compactVersion = version.replace(".", "");
  const archivePrefix = `nvhpc_${year}_${compactVersion}_${NV_ARCH[inputs.arch]}_cuda_`;
  let cudaVersion = "11.0";

  if (compareNvhpcVersions(version, "20.9") > 0) {
    cudaVersion = await findTarballCudaVersion(version, archivePrefix);
  }

  const archiveBase = `${archivePrefix}${cudaVersion}`;
  const archiveName = `${archiveBase}.tar.gz`;
  const tempDir = fs.mkdtempSync(
    path.join(os.tmpdir(), "setup-fortran-nvhpc-"),
  );
  const archivePath = path.join(tempDir, archiveName);
  const url =
    `https://developer.download.nvidia.com/hpc-sdk/${version}/` + archiveName;

  try {
    core.info(`Downloading NVIDIA HPC SDK tarball from ${url}...`);
    await exec.exec("curl", [
      ...CURL_RETRY_ARGS,
      "--retry-max-time",
      "3600",
      "--max-time",
      "3600",
      "-o",
      archivePath,
      url,
    ]);

    core.info(`Extracting ${archiveName}...`);
    await exec.exec("tar", ["-xzf", archivePath, "-C", tempDir]);

    const installer = path.join(tempDir, archiveBase, "install");
    core.info("Installing NVIDIA HPC SDK from the tarball...");
    await exec.exec("sudo", [
      "env",
      "NVHPC_SILENT=true",
      "NVHPC_INSTALL_DIR=/opt/nvidia/hpc_sdk",
      "NVHPC_INSTALL_TYPE=single",
      installer,
    ]);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

async function findTarballCudaVersion(
  version: string,
  archivePrefix: string,
): Promise<string> {
  for (const cudaVersion of CUDA_VERSIONS) {
    const url =
      `https://developer.download.nvidia.com/hpc-sdk/${version}/` +
      `${archivePrefix}${cudaVersion}.tar.gz`;
    const result = await exec.getExecOutput(
      "curl",
      ["-4", "-fsSI", "--connect-timeout", "15", "--max-time", "30", url],
      { ignoreReturnCode: true, silent: true },
    );
    if (result.exitCode === 0) {
      return cudaVersion;
    }
  }

  throw new Error(
    `Could not locate a single-CUDA NVIDIA HPC SDK ${version} tarball for ${archivePrefix}.`,
  );
}

export async function installDebian(
  inputs: Inputs,
): Promise<InstallationResult> {
  const version = resolveVersion(inputs, SUPPORTED_VERSIONS);
  const aptArch = APT_ARCH[inputs.arch];
  const nvArch = NV_ARCH[inputs.arch];

  core.info(`Installing nvfortran ${version} on Linux (${inputs.arch})...`);

  const installDir = `/opt/nvidia/hpc_sdk/${nvArch}/${version}`;
  const binDir = `${installDir}/compilers/bin`;
  const cacheKey = `nvhpc-validated-v1-${version}-${inputs.arch}-${inputs.osVersion}`;

  const cacheHit = await cache.restoreCache([installDir], cacheKey);
  const compilerPaths = ["nvfortran", "nvc", "nvc++"].map(
    (compiler) => `${binDir}/${compiler}`,
  );
  const cacheValid = cacheHit
    ? await validateRestoredCompilerCache(
        `nvhpc ${version}`,
        compilerPaths,
        compilerPaths[0],
        ["--version"],
      )
    : false;
  if (cacheValid) {
    core.info(`Restored nvhpc ${version} from cache.`);
  } else {
    if (cacheHit) {
      await exec.exec("sudo", ["rm", "-rf", installDir]);
    }
    if (inputs.cleanupDisk) await cleanupDisk();

    core.info("Checking if legacy ncurses5 libs are needed...");
    if (
      compareNvhpcVersions(version, LEGACY_NCURSES_MAX_VERSION) <= 0 &&
      (await needsLegacyNcursesInstall())
    ) {
      core.info(
        `nvhpc ${version} requires legacy ncurses5 libs; installing from jammy archive...`,
      );
      await installLegacyNcurses(inputs);
    }

    if (compareNvhpcVersions(version, "20.11") < 0) {
      core.info(
        `NVIDIA did not publish ${version} in its apt repository; using the tarball installer.`,
      );
      await installTarball(version, inputs);
    } else {
      const pkgName = `nvhpc-${version.replace(".", "-")}`;
      try {
        core.info("Adding NVIDIA HPC SDK apt repository...");
        const curlCmd = `curl ${CURL_RETRY_ARGS.join(" ")} https://developer.download.nvidia.com/hpc-sdk/ubuntu/DEB-GPG-KEY-NVIDIA-HPC-SDK | sudo gpg --dearmor -o /usr/share/keyrings/nvidia-hpcsdk-archive-keyring.gpg`;
        await execWithRetry("bash", ["-c", curlCmd]);

        await exec.exec("bash", [
          "-c",
          `echo 'deb [signed-by=/usr/share/keyrings/nvidia-hpcsdk-archive-keyring.gpg]` +
            ` https://developer.download.nvidia.com/hpc-sdk/ubuntu/${aptArch} /'` +
            ` | sudo tee /etc/apt/sources.list.d/nvhpc.list`,
        ]);

        core.info("Updating apt repositories with retry...");
        await execWithRetry(
          "sudo",
          [
            "timeout",
            "--signal=TERM",
            "--kill-after=10s",
            "5m",
            "apt-get",
            "update",
            "-y",
            ...APT_NETWORK_OPTIONS,
          ],
          3,
          10_000,
        );

        core.info(`Installing apt package ${pkgName}...`);
        await exec.exec("sudo", [
          "timeout",
          "--signal=TERM",
          "--kill-after=30s",
          "15m",
          "apt-get",
          "install",
          "-y",
          ...APT_NETWORK_OPTIONS,
          "--no-install-recommends",
          "-o",
          "Dpkg::Options::=--force-confdef",
          "-o",
          "Dpkg::Options::=--force-confold",
          pkgName,
        ]);
      } catch (aptErr) {
        core.warning(
          `APT installation failed for ${pkgName} (${String(aptErr)}). Falling back to NVIDIA's versioned tarball installer...`,
        );
        await installTarball(version, inputs);
      }
    }

    core.info("Cleaning up apt archives...");
    await exec.exec("sudo", ["apt-get", "clean"]);

    core.info(`Saving nvhpc ${version} to cache...`);
    await saveCompilerCache([installDir], cacheKey);
  }

  core.info(`Adding ${binDir} to PATH...`);
  core.addPath(binDir);

  const libDir = `${installDir}/compilers/lib`;
  const existingLdPath = process.env.LD_LIBRARY_PATH ?? "";
  core.exportVariable(
    "LD_LIBRARY_PATH",
    existingLdPath ? `${libDir}:${existingLdPath}` : libDir,
  );

  const resolvedVersion = await resolveInstalledVersion();
  core.info(`nvfortran ${resolvedVersion} installed successfully.`);
  return {
    version: resolvedVersion,
    fc: "nvfortran",
    cc: "nvc",
    cxx: "nvc++",
  };
}

async function cleanupDisk(): Promise<void> {
  let output = "";
  await exec.exec("df", ["--output=avail", "-BG", "/"], {
    listeners: { stdout: (data) => (output += data.toString()) },
    silent: true,
  });

  const availGb = parseInt(output.trim().split("\n")[1], 10);
  core.info(`${availGb.toString()}GB available. Running safe disk cleanup...`);

  await exec.exec("sudo", ["apt-get", "clean"]);
  await exec.exec("sudo", ["docker", "image", "prune", "--all", "--force"], {
    ignoreReturnCode: true,
    silent: true,
  });

  const toolkitsToRemove = [
    "/usr/local/lib/android",
    "/opt/ghc",
    "/usr/share/dotnet",
    "/opt/hostedtoolcache",
  ];

  for (const toolkit of toolkitsToRemove) {
    if (fs.existsSync(toolkit)) {
      core.info(`Removing ${toolkit} to free up disk space...`);
      try {
        await exec.exec("sudo", ["rm", "-rf", toolkit], { silent: true });
      } catch (e) {
        core.debug(`Failed to remove ${toolkit}: ${String(e)}`);
      }
    }
  }

  output = "";
  await exec.exec("df", ["--output=avail", "-BG", "/"], {
    listeners: { stdout: (data) => (output += data.toString()) },
    silent: true,
  });
  const availGbAfter = parseInt(output.trim().split("\n")[1], 10);
  core.info(`${availGbAfter.toString()}GB available after cleanup.`);
}

async function resolveInstalledVersion(): Promise<string> {
  let output = "";
  await exec.exec("nvfortran", ["--version"], {
    listeners: {
      stdout: (data: Buffer) => {
        output += data.toString();
      },
    },
  });
  return output.trim();
}
