import * as core from "@actions/core";
import { Compiler, LATEST, type Msystem, type Inputs } from "./types";

// ==========================================
// Reusable Network Helper (Upgraded)
// ==========================================

interface FetchRetryOptions {
  maxRetries?: number;
  timeoutMs?: number;
  headers?: Record<string, string>;
}

interface FetchResult<T> {
  status: number;
  data: T | null;
}

const MAX_GITHUB_RATE_LIMIT_WAIT_MS = 30_000;

class GitHubRateLimitError extends Error {}

/**
 * A production-grade wrapper around native fetch that handles stream timeouts,
 * precise GitHub rate-limit reset windows, and exponential backoff.
 */
async function fetchJsonWithRetry<T>(
  url: string,
  options: FetchRetryOptions = {},
): Promise<FetchResult<T>> {
  const maxRetries = options.maxRetries ?? 3;
  const timeoutMs = options.timeoutMs ?? 5000;
  const fetchOptions = { headers: options.headers };

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => {
      controller.abort();
    }, timeoutMs);

    try {
      const response = await fetch(url, {
        ...fetchOptions,
        signal: controller.signal,
      });

      if (response.status === 404) {
        clearTimeout(timeoutId);
        return { status: 404, data: null };
      }

      // A short reset window is worth waiting for, but an exhausted anonymous
      // quota can otherwise suspend the action for close to an hour.
      if (response.status === 403 || response.status === 429) {
        const resetHeader = response.headers.get("x-ratelimit-reset");
        if (resetHeader) {
          const resetTimeMs = parseInt(resetHeader, 10) * 1000;
          const sleepTimeMs = Math.max(resetTimeMs - Date.now() + 1000, 2000);

          if (!Number.isFinite(resetTimeMs)) {
            throw new GitHubRateLimitError(
              `GitHub API rate limit response contained an invalid x-ratelimit-reset value: ${resetHeader}.`,
            );
          }

          if (sleepTimeMs > MAX_GITHUB_RATE_LIMIT_WAIT_MS) {
            throw new GitHubRateLimitError(
              `GitHub API rate limit for ${url} resets at ${new Date(resetTimeMs).toISOString()} ` +
                `(${Math.ceil(sleepTimeMs / 1000).toString()} seconds away), which exceeds the ` +
                `${(MAX_GITHUB_RATE_LIMIT_WAIT_MS / 1000).toString()}-second maximum wait. ` +
                "Retry later or provide a GITHUB_TOKEN with available API quota.",
            );
          }

          if (attempt === maxRetries) {
            throw new GitHubRateLimitError(
              `GitHub API rate limit remained active after ${maxRetries.toString()} attempts for ${url}. ` +
                `Retry after ${new Date(resetTimeMs).toISOString()} or provide a GITHUB_TOKEN with available API quota.`,
            );
          }

          core.warning(
            `GitHub API Rate limit hit (Status ${response.status.toString()}). ` +
              `Sleeping for ${(sleepTimeMs / 1000).toString()}s until reset window opens...`,
          );

          clearTimeout(timeoutId);
          await new Promise((resolve) => setTimeout(resolve, sleepTimeMs));
          continue;
        }

        throw new GitHubRateLimitError(
          `GitHub API returned status ${response.status.toString()} for ${url} without a usable ` +
            "x-ratelimit-reset header, so the action cannot retry safely. Check GITHUB_TOKEN permissions and quota, then retry.",
        );
      }

      if (!response.ok) {
        throw new Error(
          `HTTP ${response.status.toString()}: ${response.statusText}`,
        );
      }

      const data = (await response.json()) as T;
      clearTimeout(timeoutId);
      return { status: response.status, data };
    } catch (e) {
      clearTimeout(timeoutId);

      const error = e instanceof Error ? e : new Error(String(e));
      if (error instanceof GitHubRateLimitError) {
        throw error;
      }
      const isAbort = error.name === "AbortError";
      const errorMessage = isAbort
        ? `Request or body streaming timed out after ${timeoutMs.toString()}ms`
        : error.message;

      if (attempt === maxRetries) {
        throw new Error(
          `Request failed after ${maxRetries.toString()} attempts. Last error: ${errorMessage}`,
          { cause: e },
        );
      }

      const backoffMs = 1000 * Math.pow(2, attempt + 1);
      core.warning(
        `Network error encountered (${errorMessage}). Retrying in ${(backoffMs / 1000).toString()}s ` +
          `(Attempt ${attempt.toString()}/${maxRetries.toString()})...`,
      );
      await new Promise((resolve) => setTimeout(resolve, backoffMs));
    }
  }

  throw new Error("Unreachable");
}

// ==========================================
// Exported Core Functions
// ==========================================

// Compilers whose supported-version tables use bare integer majors (e.g.
// gfortran "14", flang "19"). For these a bare numeric input is a legitimate
// table entry. Every other compiler (ifx/ifort year releases, nvfortran,
// lfortran, aocc, armflang) only ships dotted/quoted releases, so a bare
// numeric input is ambiguous — it is almost always a GitHub Actions-coerced
// `YYYY.0` — and is rejected with an actionable error instead of guessed.
const BARE_NUMERIC_ACCEPTED_COMPILERS = new Set<Compiler>([
  Compiler.GFortran,
  Compiler.Flang,
]);

/**
 * Normalizes a version string by stripping a trailing `.0` patch segment.
 * For example, `5.1.0` becomes `5.1`, while `5.1` and `5.1.1` are unchanged.
 * This lets users pass the incumbent's `X.Y.0` spelling (e.g. AOCC `5.1.0`)
 * while the replacement tracks releases by minor version (`5.1`).
 */
export function stripTrailingPatchZero(version: string): string {
  const match = /^(\d+\.\d+)\.0$/.exec(version);
  return match ? match[1] : version;
}

export function resolveVersion<T extends readonly string[]>(
  inputs: Inputs,
  supportedVersions: Record<string, T | undefined>,
  {
    matchMajorIfPatch = false,
    resolveMinorToLatestPatch = false,
    stripPatchZero = false,
  }: {
    matchMajorIfPatch?: boolean;
    resolveMinorToLatestPatch?: boolean;
    stripPatchZero?: boolean;
  } = {},
): string {
  const versions = supportedVersions[inputs.arch];

  if (!versions) {
    throw new Error(
      `No supported versions found for ${inputs.compiler} on ${inputs.os} (${inputs.arch}).`,
    );
  }

  const rawVersion = inputs.version === LATEST ? versions[0] : inputs.version;

  if (!rawVersion) {
    throw new Error(
      `No supported versions found for ${inputs.compiler} on ${inputs.os} (${inputs.arch}).`,
    );
  }

  // Silently normalize X.Y.0 → X.Y (the incumbent's spelling) to the
  // replacement's minor-version release entry. Only strips a trailing .0;
  // X.Y.1 and other patch versions are left untouched so that genuinely
  // unsupported versions still produce a clear error.
  const version = stripPatchZero
    ? stripTrailingPatchZero(rawVersion)
    : rawVersion;

  // Inform the user that AOCC releases are tracked by major.minor only, so
  // specifying a .0 patch (e.g. 5.1.0) is accepted but unnecessary.
  if (stripPatchZero && version !== rawVersion) {
    core.warning(
      `The AOCC compiler specifies versions as MAJOR.MINOR. Your specified ` +
        `version "${rawVersion}" was normalized to "${version}". Consider ` +
        `dropping the patch number.`,
    );
  }

  const versionList = versions as readonly string[];
  if (!versionList.includes(version)) {
    if (matchMajorIfPatch) {
      const major = parseMajorOrPatch(version).major;
      if (versionList.includes(major)) {
        return version;
      }
    }

    // FIX: Modified standard regex to accept BOTH standard semantic numbers (e.g. 14.1) and years (e.g. 2025.1)
    if (resolveMinorToLatestPatch && /^\d+\.\d+$/.test(version)) {
      const prefix = `${version}.`;
      const match = versionList.find((v) => v.startsWith(prefix));
      if (match) {
        return match;
      }
    }

    // A bare numeric version is never a valid table entry for the year-based
    // compilers (ifx/ifort/nvfortran/lfortran/aocc/armflang). GitHub Actions
    // coerces an unquoted `version: 2026.0` YAML number to the bare string
    // "2026", silently dropping the trailing `.0`. That input is ambiguous
    // (it could mean that exact release or the latest release in the series),
    // so we refuse to guess and point the user at exact, quoted table entries.
    // gfortran/flang accept bare integer majors and are exempt. The
    // unrecoverable trailing-zero collision (2021.10 -> "2021.1") is handled
    // above by the patch-prefix fall through and is documented in the README
    // as a quoting requirement.
    if (
      !BARE_NUMERIC_ACCEPTED_COMPILERS.has(inputs.compiler) &&
      /^\d+$/.test(version)
    ) {
      const examples = versions.slice(0, 2).map((v) => `"${v}"`);
      throw new Error(
        `${inputs.compiler} version "${version}" is ambiguous and must be ` +
          `quoted exactly as listed in the supported-version table. GitHub ` +
          `Actions coerces unquoted YAML numbers into bare strings, silently ` +
          `dropping segments like ".0", so the intended release is unclear; ` +
          `specify the full release (e.g. ${examples.join(" or ")}) wrapped ` +
          `in quotes. (gfortran and flang accept bare integer majors such as ` +
          `"14" or "19".) Supported versions: ${versions.join(", ")}`,
      );
    }

    throw new Error(
      `${inputs.compiler} ${version} is not supported on ${inputs.os} (${inputs.arch}). ` +
        `Supported versions: ${versions.join(", ")}`,
    );
  }

  return version;
}

export function resolveWindowsVersion(
  inputs: Inputs,
  supportedVersions: Record<
    string,
    Record<Msystem, readonly string[] | undefined> | undefined
  >,
  {
    matchMajorIfPatch = false,
    resolveMinorToLatestPatch = false,
  }: { matchMajorIfPatch?: boolean; resolveMinorToLatestPatch?: boolean } = {},
): string {
  const archVersions = supportedVersions[inputs.arch];
  if (!archVersions) {
    throw new Error(
      `Architecture "${inputs.arch}" is not supported for ${inputs.compiler} on Windows.`,
    );
  }

  const msystem = inputs.msystem;
  const versions = archVersions[msystem];
  if (!versions) {
    throw new Error(
      `The environment "${msystem}" is not supported for Windows ${inputs.arch}.`,
    );
  }

  return resolveVersion(
    inputs,
    { [inputs.arch]: versions },
    { matchMajorIfPatch, resolveMinorToLatestPatch },
  );
}

// FIX: Handles string segmentation gracefully for minor versions (length === 2)
export function parseMajorOrPatch(input: string): {
  major: string;
  patch: string | undefined;
} {
  const parts = input.split(".");
  if (parts.length >= 1 && parts.length <= 3) {
    return {
      major: parts[0],
      patch: parts.length === 3 ? input : undefined,
    };
  }
  throw new Error(
    `Invalid version format: "${input}". Specify a major version (e.g. "22"), minor (e.g. "22.1") or full patch version (e.g. "22.1.3").`,
  );
}

interface GitHubRelease {
  tag_name: string;
  prerelease: boolean;
}

// FIX: Added multi-page fallback strategy to guarantee legacy version visibility
export async function resolveLatestPatch(
  repo: string,
  major: string,
  tagPrefix = `llvmorg-${major}.`,
  tagStripper: (tag: string) => string = (tag) => tag.replace("llvmorg-", ""),
): Promise<string> {
  core.info(
    `Resolving latest patch version for ${repo} major ${major} via GitHub API...`,
  );

  // Walk up to 3 pagination indexes to unearth deep historical patches
  for (let page = 1; page <= 3; page++) {
    const url = `https://api.github.com/repos/${repo}/releases?per_page=100&page=${page.toString()}`;
    const { data: releases } = await fetchJsonWithRetry<GitHubRelease[]>(url, {
      headers: githubHeaders(),
    });

    if (!releases || releases.length === 0) {
      break;
    }

    const match = releases.find(
      (r) =>
        r.tag_name.startsWith(tagPrefix) &&
        !r.prerelease &&
        !r.tag_name.includes("rc"),
    );

    if (match) {
      return tagStripper(match.tag_name);
    }
  }

  throw new Error(
    `No stable release found for ${repo} major ${major} within visible historical GitHub releases.`,
  );
}

interface GitHubTagMetadata {
  assets: { name: string; digest?: string | null }[];
}

export async function verifyAssetExists(
  repo: string,
  patch: string,
  filename: string,
  tagFromPatch: (patch: string) => string = (p) => `llvmorg-${p}`,
): Promise<string | undefined> {
  const tag = tagFromPatch(patch);
  core.info(`Verifying that ${filename} exists for ${repo} release ${tag}...`);

  const url = `https://api.github.com/repos/${repo}/releases/tags/${tag}`;
  const { status, data: release } = await fetchJsonWithRetry<GitHubTagMetadata>(
    url,
    {
      headers: githubHeaders(),
    },
  );

  if (status === 404) {
    throw new Error(
      `Requested version "${patch}" does not exist (no release for ${tag} in ${repo}).`,
    );
  }

  if (!release) {
    throw new Error(
      `Failed to fetch release metadata for tag ${tag} in ${repo}.`,
    );
  }

  const asset = release.assets.find((a) => a.name === filename);
  if (!asset) {
    throw new Error(
      `Release ${tag} in ${repo} exists but has no asset "${filename}". ` +
        `See https://github.com/${repo}/releases/tag/${tag} for available assets.`,
    );
  }

  if (!asset.digest?.startsWith("sha256:")) {
    core.warning(
      `GitHub does not provide a SHA-256 digest for ${repo} release asset ${filename}; ` +
        `download integrity cannot be verified automatically for this legacy asset.`,
    );
    return undefined;
  }

  const digest = asset.digest.slice("sha256:".length).toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(digest)) {
    throw new Error(
      `GitHub returned an invalid SHA-256 digest for ${repo} release asset ${filename}.`,
    );
  }
  return digest;
}

function githubHeaders(): Record<string, string> {
  const headers: Record<string, string> = {
    Accept: "application/vnd.github+json",
  };
  const token = process.env.GITHUB_TOKEN;
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  } else {
    core.warning(
      "GITHUB_TOKEN is missing from the environment. Concurrent execution of these tests will likely hit rate limits and fail.",
    );
  }
  return headers;
}
