import * as core from "@actions/core";
import * as exec from "@actions/exec";
import * as fs from "fs";
import * as cache from "@actions/cache";

export async function validateRestoredCompilerCache(
  label: string,
  requiredPaths: string[],
  command: string,
  args: string[],
): Promise<boolean> {
  const missing = requiredPaths.filter((entry) => !fs.existsSync(entry));
  if (missing.length > 0) {
    core.info(
      `Restored ${label} cache is incomplete; missing: ${missing.join(", ")}. Reinstalling.`,
    );
    return false;
  }

  try {
    let output = "";
    const append = (data: Buffer): void => {
      output += data.toString();
    };
    const exitCode = await exec.exec(command, args, {
      ignoreReturnCode: true,
      silent: true,
      listeners: { stdout: append, stderr: append },
    });
    if (exitCode === 0) return true;
    if (output.trim()) core.info(output.trim());
    core.info(
      `Restored ${label} cache failed compiler validation with exit code ${exitCode.toString()}. Reinstalling.`,
    );
  } catch (error) {
    core.info(
      `Restored ${label} cache failed compiler validation: ${String(error)}. Reinstalling.`,
    );
  }
  return false;
}

export function cacheKeySuffix(): string {
  return process.env.SETUP_FORTRAN_CACHE_KEY_SUFFIX ?? "";
}

export async function restoreCompilerCache(
  enabled: boolean,
  paths: string[],
  key: string,
): Promise<string | undefined> {
  if (!enabled) {
    core.info(`Caching disabled; skipping restore of ${key}.`);
    return undefined;
  }
  return cache.restoreCache(paths, key);
}

export async function saveCompilerCache(
  enabled: boolean,
  paths: string[],
  key: string,
): Promise<void> {
  if (!enabled) {
    core.info(`Caching disabled; skipping save of ${key}.`);
    return;
  }
  core.info(`Saving ${key} to cache...`);
  try {
    await cache.saveCache(paths, key);
  } catch (error) {
    core.info(`Could not save compiler cache ${key}: ${String(error)}`);
  }
}
