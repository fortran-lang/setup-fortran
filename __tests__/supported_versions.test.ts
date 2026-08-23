/*
 * Regression guard for `version: latest` resolution.
 *
 * `resolveVersion`/`resolveWindowsVersion` install `versions[0]` when the user
 * requests `"latest"`. That only resolves to the *newest* release when each
 * installer's SUPPORTED_VERSIONS list is kept in descending numeric order (with
 * the `LATEST` rolling-release marker leading, if present). The installer
 * sources carry a manual comment asking for exactly this ordering — this test
 * makes it enforced instead of wishful thinking, so adding a new compiler
 * release without re-sorting the list fails CI rather than silently pointing
 * `latest` at a stale release.
 */

import { LATEST } from "../src/types";
import {
  compareVersions,
  isVersionListDescending,
} from "../src/resolve_version";

// Installer modules transitively import the `@actions/*` libraries, which
// assume a live runner. Stub them out so we can import the (static) version
// tables in a plain node test environment.
jest.mock("@actions/core");
jest.mock("@actions/exec");
jest.mock("@actions/cache");
jest.mock("@actions/tool-cache");

import { SUPPORTED_VERSIONS as gfortranDarwin } from "../src/installers/gfortran/darwin";
import { SUPPORTED_VERSIONS as gfortranDebian } from "../src/installers/gfortran/debian";
import { SUPPORTED_VERSIONS as gfortranWin32 } from "../src/installers/gfortran/win32";
import { SUPPORTED_VERSIONS as flangDarwin } from "../src/installers/flang/darwin";
import { SUPPORTED_VERSIONS as flangDebian } from "../src/installers/flang/debian";
import { SUPPORTED_VERSIONS as flangWin32 } from "../src/installers/flang/win32";
import { SUPPORTED_VERSIONS as armflangDebian } from "../src/installers/armflang/debian";
import { SUPPORTED_VERSIONS as nvfortranDebian } from "../src/installers/nvfortran/debian";
import { SUPPORTED_VERSIONS as aoccDebian } from "../src/installers/aocc/debian";
import { SUPPORTED_VERSIONS as ifortDarwin } from "../src/installers/ifort/darwin";
import { SUPPORTED_VERSIONS as ifortDebian } from "../src/installers/ifort/debian";
import { SUPPORTED_VERSIONS as ifortWin32 } from "../src/installers/ifort/win32";
import { SUPPORTED_VERSIONS as lfortranDarwin } from "../src/installers/lfortran/darwin";
import { SUPPORTED_VERSIONS as lfortranDebian } from "../src/installers/lfortran/debian";
import { SUPPORTED_VERSIONS as lfortranWin32 } from "../src/installers/lfortran/win32";
import { SUPPORTED_VERSIONS as ifxDebian } from "../src/installers/ifx/debian";
import { SUPPORTED_VERSIONS as ifxWin32 } from "../src/installers/ifx/win32";

interface VersionList {
  label: string;
  versions: readonly string[];
}

/**
 * Recursively harvests every leaf `string[]` from a nested version table.
 *
 * Tables come in two shapes:
 *   - Linux:  Record<Arch, string[] | undefined>
 *   - Windows: Record<Arch, Record<Msystem, string[] | undefined>>
 * This walker is shape-agnostic: it recurses into objects and collects leaf
 * arrays, ignoring `undefined` cells (unsupported arch/msystem). Empty arrays
 * are *not* ignored — they are harvested so the structural test can reject them
 * (an empty list is truthy, so `resolveVersion` would bypass its `!versions`
 * guard and then fail on `versions[0] === undefined` with a confusing error).
 * `LATEST` entries are kept as-is so the descending assertion also enforces
 * that they lead the list.
 */
function collectVersionLists(table: unknown, prefix: string): VersionList[] {
  const lists: VersionList[] = [];
  if (table === null || typeof table !== "object") return lists;
  for (const [key, value] of Object.entries(table as Record<string, unknown>)) {
    const loc = `${prefix}[${key}]`;
    if (Array.isArray(value)) {
      if (value.every((v): v is string => typeof v === "string")) {
        lists.push({ label: loc, versions: value });
      }
    } else if (value !== null && typeof value === "object") {
      lists.push(...collectVersionLists(value, loc));
    }
  }
  return lists;
}

const VERSION_TABLES = [
  { module: "gfortran/darwin", table: gfortranDarwin },
  { module: "gfortran/debian", table: gfortranDebian },
  { module: "gfortran/win32", table: gfortranWin32 },
  { module: "flang/darwin", table: flangDarwin },
  { module: "flang/debian", table: flangDebian },
  { module: "flang/win32", table: flangWin32 },
  { module: "armflang/debian", table: armflangDebian },
  { module: "nvfortran/debian", table: nvfortranDebian },
  { module: "aocc/debian", table: aoccDebian },
  { module: "ifort/darwin", table: ifortDarwin },
  { module: "ifort/debian", table: ifortDebian },
  { module: "ifort/win32", table: ifortWin32 },
  { module: "lfortran/darwin", table: lfortranDarwin },
  { module: "lfortran/debian", table: lfortranDebian },
  { module: "lfortran/win32", table: lfortranWin32 },
  { module: "ifx/debian", table: ifxDebian },
  { module: "ifx/win32", table: ifxWin32 },
] as const;

const ALL_VERSION_LISTS = VERSION_TABLES.flatMap((entry) =>
  collectVersionLists(entry.table, entry.module),
);

describe("version ordering helpers", () => {
  it("treats LATEST as newer than any concrete version", () => {
    expect(compareVersions(LATEST, "999.0")).toBeGreaterThan(0);
    expect(compareVersions("999.0", LATEST)).toBeLessThan(0);
  });

  it("ranks a longer segment sequence above its prefix (2026.1.1 > 2026.1)", () => {
    expect(compareVersions("2026.1.1", "2026.1")).toBeGreaterThan(0);
    expect(compareVersions("2026.1", "2026.1.1")).toBeLessThan(0);
  });

  it("compares numeric segments, not lexicographical (2021.10 > 2021.2)", () => {
    expect(compareVersions("2021.10", "2021.2")).toBeGreaterThan(0);
  });

  it("flags ascending and out-of-order lists as not descending", () => {
    expect(isVersionListDescending(["2026.1", "2026.1.1"])).toBe(false);
    expect(isVersionListDescending(["15", "16"])).toBe(false);
    expect(isVersionListDescending(["2026.1.1", "2026.1", "2026.2"])).toBe(
      false,
    );
  });

  it("accepts a single version, an empty list, and a leading LATEST", () => {
    expect(isVersionListDescending(["16"])).toBe(true);
    expect(isVersionListDescending([])).toBe(true);
    expect(isVersionListDescending([LATEST, "22", "21", "20"])).toBe(true);
    expect(isVersionListDescending(["22", "21", "20"])).toBe(true);
  });

  it("rejects a LATEST that is not the leading entry", () => {
    expect(isVersionListDescending(["19", LATEST, "18"])).toBe(false);
  });
});

describe("supported version tables are well-formed", () => {
  // Each table cell is typed as `readonly string[] | undefined` (unsupported
  // arch/msystem) — an invariant the compiler already enforces. The one thing
  // the type system cannot express is that a present list is never empty: an
  // empty array is truthy, so `resolveVersion` skips its `!versions` guard and
  // then fails on `versions[0] === undefined` with a misleading error. Catch
  // that structural defect here rather than at install time.
  it.each(ALL_VERSION_LISTS)("is non-empty: $label", ({ versions }) => {
    expect(versions.length).toBeGreaterThan(0);
  });
});

describe("supported version tables are ordered newest-first", () => {
  // `resolveVersion` installs `versions[0]` when the user requests "latest".
  // A list that is not descending therefore resolves "latest" to a stale
  // release — exactly the regression the maintainers' "make sure the versions
  // are always in descending order" comments warn about.
  it.each(ALL_VERSION_LISTS.filter(({ versions }) => versions.length > 0))(
    "resolves latest correctly for $label",
    ({ versions }) => {
      const newest = versions.reduce((acc, v) =>
        compareVersions(v, acc) > 0 ? v : acc,
      );
      expect(isVersionListDescending(versions)).toBe(true);
      // The first entry is what `version: "latest"` installs; it must be the
      // numerically newest so "latest" never silently lands on a stale release.
      expect(versions[0]).toBe(newest);
    },
  );

  it("exercises a version list for every installer that resolves versions", () => {
    // Guard against silently dropping an installer (or an arch/msystem) from
    // this check: each exported table must contribute at least one list.
    const covered = new Set(ALL_VERSION_LISTS.map((l) => l.label));
    expect(covered.size).toBeGreaterThan(0);
    expect(
      VERSION_TABLES.every((entry) =>
        ALL_VERSION_LISTS.some((l) => l.label.startsWith(entry.module)),
      ),
    ).toBe(true);
  });
});
