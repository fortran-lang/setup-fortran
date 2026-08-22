import * as core from "@actions/core";
import * as exec from "@actions/exec";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { Arch, type InstallationResult } from "../../types";
import { resolveVersion } from "../../resolve_version";
import type { Inputs } from "../../types";
import { verifySha256 } from "../../verify_download";

// Make sure the versions are always in descending order. The first one will be
// used as the default if no version was specified by the user.
//
// Notes:
//   - Only major versions are meaningful here: neither llvm.sh nor the apt
//     repository accept minor/patch versions, so the installed patch is always
//     whatever the LLVM apt repo currently serves for that major.
//   - Binary naming history:
//       LLVM 15–16: binary is `flang-new` (F18 rewrite, still under the old name)
//       LLVM 17–19: binary is `flang-new` (same, stabilised)
//       LLVM 20+:   binary renamed to `flang` (flang-new still present as alias)
//   - ARM64: LLVM 15/16 have no noble (24.04) repo and broken jammy (22.04)
//     packaging. 17 is the effective floor on arm64.
//   - X64: LLVM 15/16 are available on jammy (22.04) only; no noble repo.
const SUPPORTED_VERSIONS = {
  [Arch.X64]: ["22", "21", "20", "19", "18", "17", "16"],
  [Arch.ARM64]: ["22", "21", "20", "19", "18", "17"],
} as const satisfies Record<Arch, readonly string[]>;

const LLVM_APT_KEY_SHA256 =
  "8b2a587ffd672c4687e7581dad4b2f6c1bb2ad6b480cd9771ba2ff48e0b8c75d";
const APT_NETWORK_OPTIONS = [
  "-o",
  "Acquire::ForceIPv4=true",
  "-o",
  "Acquire::Retries=0",
  "-o",
  "Acquire::http::Timeout=10",
  "-o",
  "Acquire::https::Timeout=10",
];

function ubuntuCodename(osVersion: string): string {
  if (osVersion.includes("24.04") || osVersion.includes("ubuntu24")) {
    return "noble";
  }
  if (osVersion.includes("22.04") || osVersion.includes("ubuntu22")) {
    return "jammy";
  }
  throw new Error(
    `Flang is only supported on Ubuntu 22.04 and 24.04 (got: ${osVersion}).`,
  );
}

async function configureLlvmAptRepository(
  version: string,
  osVersion: string,
): Promise<void> {
  const codename = ubuntuCodename(osVersion);
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "setup-fortran-llvm-"));
  const downloadedKey = path.join(tempDir, "llvm-snapshot.gpg.key");
  const keyring = path.join(tempDir, "llvm-snapshot.gpg");
  const sourceList = path.join(tempDir, "llvm.list");

  try {
    await exec.exec("curl", [
      "-4",
      "-fsSL",
      "--connect-timeout",
      "10",
      "--max-time",
      "60",
      "--retry",
      "3",
      "--retry-delay",
      "5",
      "-o",
      downloadedKey,
      "https://apt.llvm.org/llvm-snapshot.gpg.key",
    ]);
    await verifySha256(downloadedKey, LLVM_APT_KEY_SHA256);
    await exec.exec("gpg", [
      "--dearmor",
      "--yes",
      "--output",
      keyring,
      downloadedKey,
    ]);

    fs.writeFileSync(
      sourceList,
      `deb [signed-by=/usr/share/keyrings/llvm-snapshot.gpg] https://apt.llvm.org/${codename}/ llvm-toolchain-${codename}-${version} main\n`,
    );

    await exec.exec("sudo", [
      "install",
      "-m",
      "0644",
      keyring,
      "/usr/share/keyrings/llvm-snapshot.gpg",
    ]);
    await exec.exec("sudo", [
      "install",
      "-m",
      "0644",
      sourceList,
      "/etc/apt/sources.list.d/llvm.list",
    ]);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

// Returns the name of the canonical flang binary for a given major version.
// This reflects the upstream rename from `flang-new` to `flang` in LLVM 20.
function flangBinaryName(major: number): string {
  return major >= 20 ? "flang" : "flang-new";
}

// Resolves the on-disk path of the flang binary after installation.
//
// The apt packages install the real binary under /usr/lib/llvm-<N>/bin/ and
// create symlinks in /usr/bin. The symlink names vary by version and platform:
//
//   LLVM 15–16: packaging is inconsistent — /usr/lib/llvm-N/bin/flang-new
//               exists on some platforms but /usr/bin may only have a bare
//               `flang` or nothing versioned at all.
//   LLVM 17–19: /usr/lib/llvm-N/bin/flang-new is reliable.
//   LLVM 20+:   /usr/lib/llvm-N/bin/flang is the real binary;
//               flang-new is a symlink to it.
//
// We probe the most reliable locations first.
function resolveFlangBinaryPath(major: number, version: string): string {
  const binaryName = flangBinaryName(major);

  const candidates = [
    `/usr/lib/llvm-${version}/bin/${binaryName}`, // most reliable across all versions
    `/usr/bin/${binaryName}-${version}`, // versioned symlink in /usr/bin
    `/usr/bin/flang-new-${version}`, // fallback for 15/16 on some platforms
    `/usr/bin/flang`, // last-resort bare path (15/16 jammy)
  ];

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      core.info(`Found flang binary at: ${candidate}`);
      return candidate;
    }
  }

  throw new Error(
    `Flang binary not found in any expected location for LLVM ${version}. Checked:\n` +
      candidates.map((c) => `  ${c}`).join("\n"),
  );
}

export async function installDebian(
  inputs: Inputs,
): Promise<InstallationResult> {
  const version = resolveVersion(inputs, SUPPORTED_VERSIONS);
  const major = parseInt(version, 10);

  core.info(`Installing Flang ${version} on Linux (${inputs.arch})...`);

  core.info(`Adding the verified LLVM ${version} apt repository...`);
  await configureLlvmAptRepository(version, inputs.osVersion);
  await aptGetUpdateWithRetry();

  const pkgName = `flang-${version}`;

  core.info(
    `Installing apt package ${pkgName} with LLVM runtime dependencies...`,
  );
  await exec.exec("sudo", [
    "timeout",
    "--signal=TERM",
    "--kill-after=30s",
    "15m",
    "apt-get",
    "install",
    "-y",
    ...APT_NETWORK_OPTIONS,
    // The LLVM apt `flang-N` package does not declare `clang-N` as a
    // dependency (unlike Ubuntu-archive flang-17/18 on noble, which pull it
    // in transitively). flang links against clang as its host C/C++ compiler
    // and the action advertises it as $CC/$CXX, so it must be installed
    // explicitly — otherwise the companion-compiler verification fails.
    `clang-${version}`,
    pkgName,
    `libomp-${version}-dev`,
    `libclang-rt-${version}-dev`,
  ]);

  const binaryPath = resolveFlangBinaryPath(major, version);

  if (binaryPath !== "/usr/bin/flang") {
    core.info(
      `Registering update-alternatives: /usr/bin/flang -> ${binaryPath}`,
    );
    await exec.exec("sudo", [
      "update-alternatives",
      "--install",
      "/usr/bin/flang",
      "flang",
      binaryPath,
      "100",
    ]);
  }

  const llvmBinDir = `/usr/lib/llvm-${version}/bin`;
  if (fs.existsSync(llvmBinDir)) {
    core.addPath(llvmBinDir);
  }

  core.exportVariable("FLANG_VERSION", major);

  const llvmLibDir = `/usr/lib/llvm-${version}/lib`;
  if (fs.existsSync(llvmLibDir)) {
    const existing = process.env.LIBRARY_PATH ?? "";
    core.exportVariable(
      "LIBRARY_PATH",
      existing ? `${llvmLibDir}:${existing}` : llvmLibDir,
    );
  }

  const result = {
    version: await resolveInstalledVersion(
      `${flangBinaryName(major)}-${version}`,
    ),
    fc: `${flangBinaryName(major)}-${version}`,
    // Reference the unversioned clang/clang++ shipped inside the LLVM install
    // dir (always present once `clang-N` is installed) rather than the
    // /usr/bin clang-N symlinks. Those symlinks compile to different versioned
    // names across apt sources — Ubuntu archive uses `clang++-N` (dash) while
    // apt.llvm.org uses `clang++N` (no dash) — so a single versioned cxx name
    // cannot satisfy both. The absolute path is repo-agnostic and matches the
    // darwin installer.
    cc: `${llvmBinDir}/clang`,
    cxx: `${llvmBinDir}/clang++`,
  };
  const resolvedVersion = result.version;
  core.info(`Flang ${resolvedVersion} installed successfully.`);
  return result;
}

async function aptGetUpdateWithRetry(maxAttempts = 3): Promise<void> {
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const exitCode = await exec.exec(
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
      { ignoreReturnCode: true },
    );

    if (exitCode === 0) return;

    if (attempt === maxAttempts) {
      throw new Error(
        `apt-get update failed after ${maxAttempts.toString()} attempts with exit code ${exitCode.toString()}.`,
      );
    }

    const delaySeconds = attempt * 10;

    core.warning(
      `apt-get update failed (attempt ${attempt.toString()}/${maxAttempts.toString()}), retrying in ${delaySeconds.toString()}s...`,
    );

    await new Promise((resolve) => setTimeout(resolve, delaySeconds * 1000));
  }
}

async function resolveInstalledVersion(fc: string): Promise<string> {
  let output = "";
  await exec.exec(fc, ["--version"], {
    listeners: {
      stdout: (data: Buffer) => {
        output += data.toString();
      },
    },
  });
  return output.trim();
}
