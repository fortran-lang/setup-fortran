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
import * as fs from "fs";
import * as path from "path";
import { load as yamlLoad } from "js-yaml";

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

// ---------------------------------------------------------------------------
// Test B: every version the action claims to support (SUPPORTED_VERSIONS) must
// actually be exercised by the per-compiler CI matrix
// (`.github/workflows/ci-<compiler>.yml`), so a supported release is never
// shipped untested. Two guarantees:
//
//   1. Concrete versions: each non-`LATEST` token in a table must be tested by
//      its ci-<compiler>.yml matrix. Matching is by version *family* (exact, or
//      one token extends the other by a dotted-segment boundary) so a table
//      entry is satisfied by an exact CI pin OR a fuller CI spelling
//      (e.g. table `21` <-> CI `21.1.6`; `2026.1` <-> `2026.1.0`; `16` is NOT
//      satisfied by CI `17`). Extra patch-resolution CI entries therefore do
//      not count as gaps.
//   2. Rolling-only cells: a leaf list of exactly `[LATEST]` (the
//      present-only-for-latest platforms, e.g. Windows `ucrt64`/`clang64`) must
//      have a matching no-`version` CI entry, on the same `msystem` when one is
//      present.
//
// The TS `SUPPORTED_VERSIONS` tables are the source of truth (they are what
// `resolveVersion` enforces at runtime and what Test A already guards); the
// README compatibility tables advertise the same set, so agreement holds there
// too. The `js-yaml` + `fs` reads parse the real CI YAML rather than duplicating
// its matrix by hand.
// ---------------------------------------------------------------------------

const WORKFLOWS_DIR = path.resolve(__dirname, "../.github/workflows");

interface CiMatrixInfo {
  versions: Set<string>;
  latestMsystrings: Set<string>;
  hasLatest: boolean;
}
const ciCache = new Map<string, CiMatrixInfo>();

// Walk the GitHub Actions document and return the first `strategy.matrix`
// object found (each ci-<compiler>.yml has a single job with one matrix).
function findMatrix(doc: unknown): Record<string, unknown> | undefined {
  if (!doc || typeof doc !== "object") return undefined;
  const jobs = (doc as Record<string, unknown>).jobs;
  if (!jobs || typeof jobs !== "object") return undefined;
  for (const job of Object.values(jobs as Record<string, unknown>)) {
    if (!job || typeof job !== "object") continue;
    const matrix = (job as Record<string, unknown>).strategy as
      { matrix?: unknown } | undefined;
    if (matrix?.matrix && typeof matrix.matrix === "object") {
      return matrix.matrix as Record<string, unknown>;
    }
  }
  return undefined;
}

// Extract a Windows msystem (`ucrt64`/`clang64`/`native`) from a table leaf
// label like "flang/win32[x64][ucrt64]".
function msystemOf(label: string): string | undefined {
  const m = /\[(ucrt64|clang64|native)\]/.exec(label);
  return m ? m[1] : undefined;
}

function parseCiMatrix(compiler: string): CiMatrixInfo {
  const cached = ciCache.get(compiler);
  if (cached) return cached;

  const file = path.join(WORKFLOWS_DIR, `ci-${compiler}.yml`);
  const doc = yamlLoad(fs.readFileSync(file, "utf8")) as Record<
    string,
    unknown
  >;
  const matrix = findMatrix(doc);
  if (!matrix) {
    throw new Error(`No strategy.matrix found in ${file}`);
  }

  const versions = new Set<string>();
  const latestMsystrings = new Set<string>();
  let hasLatest = false;

  // A toolchain entry with no `version` (or version === "latest") pins the
  // latest available release; record its `msystem` (if any) so [LATEST]-only
  // cells can be matched to the right Windows build.
  const visit = (entry: unknown): void => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) return;
    const e = entry as Record<string, unknown>;
    if (typeof e.compiler !== "string") return; // not a toolchain entry
    const v = e.version;
    if (typeof v === "string" && v !== LATEST) {
      versions.add(v);
    } else {
      hasLatest = true;
      if (typeof e.msystem === "string") latestMsystrings.add(e.msystem);
    }
  };

  const tc = matrix.toolchain;
  if (Array.isArray(tc)) tc.forEach(visit);
  else if (tc && typeof tc === "object") visit(tc);

  const inc = matrix.include ?? [];
  if (Array.isArray(inc)) {
    for (const item of inc) {
      if (!item || typeof item !== "object") continue;
      const o = item as Record<string, unknown>;
      if (o.toolchain) {
        if (Array.isArray(o.toolchain)) o.toolchain.forEach(visit);
        else if (o.toolchain && typeof o.toolchain === "object")
          visit(o.toolchain);
      } else if (typeof o.image === "string") {
        hasLatest = true; // image-only include => default compiler at "latest"
      }
    }
  }

  const info: CiMatrixInfo = { versions, latestMsystrings, hasLatest };
  ciCache.set(compiler, info);
  return info;
}

// --- Pure, IO-free coverage predicates (unit-tested below as negative cases) -

// A concrete table token is satisfied by an exact CI pin, a more-specific CI
// release (CI "21.1.6" covers table "21"), or a less-specific CI release
// (CI "2026.1" covers table "2026.1.0"). The dotted-segment boundary keeps
// "2026" from matching "20260" and "21" from matching "21.1".
function versionFamilyCovered(token: string, ciVersions: Set<string>): boolean {
  if (ciVersions.has(token)) return true;
  for (const v of ciVersions) {
    if (token.startsWith(`${v}.`) || v.startsWith(`${token}.`)) return true;
  }
  return false;
}

// A `[LATEST]`-only cell is satisfied when CI has a no-`version` entry: on the
// same `msystem` when the cell declares one, or anywhere when it does not.
function latestCellCovered(
  label: string,
  latestMsystrings: Set<string>,
  hasLatest: boolean,
): boolean {
  const msystem = msystemOf(label);
  return msystem ? latestMsystrings.has(msystem) : hasLatest;
}

describe("supported version tables are exercised by CI (Test B)", () => {
  it("every concrete supported version is tested by its ci-<compiler>.yml matrix", () => {
    const uncovered: Array<{ where: string; compiler: string; token: string }> =
      [];
    for (const list of ALL_VERSION_LISTS) {
      const compiler = list.label.split("/")[0];
      const ci = parseCiMatrix(compiler);
      for (const token of list.versions) {
        if (token === LATEST) continue;
        if (!versionFamilyCovered(token, ci.versions)) {
          uncovered.push({ where: list.label, compiler, token });
        }
      }
    }
    if (uncovered.length > 0) {
      throw new Error(
        "These supported versions are not exercised by their CI matrix:\n" +
          uncovered
            .map(
              (u) => `  - ${u.where}: "${u.token}" (compiler "${u.compiler}")`,
            )
            .join("\n"),
      );
    }
  });

  it("every [LATEST]-only table cell has a latest test in CI", () => {
    const onlyLatestLeaves = ALL_VERSION_LISTS.filter(
      (l) => l.versions.length === 1 && l.versions[0] === LATEST,
    );
    const missing: Array<{ where: string; compiler: string }> = [];
    for (const list of onlyLatestLeaves) {
      const compiler = list.label.split("/")[0];
      const ci = parseCiMatrix(compiler);
      if (!latestCellCovered(list.label, ci.latestMsystrings, ci.hasLatest)) {
        missing.push({ where: list.label, compiler });
      }
    }
    if (missing.length > 0) {
      throw new Error(
        "These [LATEST]-only cells have no latest test in CI:\n" +
          missing
            .map((m) => `  - ${m.where} (compiler "${m.compiler}")`)
            .join("\n"),
      );
    }
  });
});

// ---------------------------------------------------------------------------
// Test B negative cases: the coverage predicates must *detect* synthetic gaps
// (not, like the integration tests above, only affirm the green state). These
// are pure unit tests over `versionFamilyCovered` / `latestCellCovered` so they
// pin the detection behaviour independently of the live CI YAML. A real
// mutation (dropping a version from ci-flang.yml) is covered by the runtime
// integration test above; these cover the contract the integration test relies
// on.
// ---------------------------------------------------------------------------
describe("Test B coverage predicates detect gaps (negative cases)", () => {
  // [token, ciVersions, expected] — positive rows confirm the rule isn't overly
  // strict; negative rows confirm it flags a genuinely-missing release and does
  // NOT false-match across dotted major/minor boundaries.
  it.each([
    // --- positives: table release is satisfied by CI ---
    ["16", ["16"], true], // exact pin
    ["21", ["21.1.6"], true], // CI patch satisfies table major
    ["21.1.6", ["21"], true], // CI major satisfies table patch
    ["2026.1", ["2026.1.0", "2026.1.1"], true], // CI minor satisfies table minor
    ["2023.2", ["2023.2.4"], true], // ifx-style: minor <-> patch family
    // --- negatives: missing release (the gap the test exists to catch) ---
    ["16", ["17", "18", "19", "20", "21", "22"], false], // flang-16-style gap
    ["18", ["17", "19", "20", "21", "22"], false], // hole in the middle
    ["16", [], false], // empty CI matrix for the compiler
    // --- boundary: dotted major/minor must not cross-match ---
    ["21", ["21.1"], true], // 21 IS the family root of 21.1
    ["2021.1", ["2021.10"], false], // NOT the same family (no dot extension)
    ["2021.10", ["2021.1"], false], // symmetric: must not match
    ["2026", ["20260"], false], // plain vs double-digit, no false match
  ])("versionFamilyCovered(%p, %p) => %p", (token, ciVersions, expected) => {
    expect(versionFamilyCovered(token, new Set(ciVersions))).toBe(expected);
  });

  // The headline negative the user described: a `[LATEST]`-only cell for one
  // configuration (e.g. Windows ucrt64) while CI only ships a latest entry for
  // a *different* configuration (clang64) — or ships no latest entry at all.
  it("flags a [LATEST]-only cell whose msystem has no latest CI entry", () => {
    // CI only ships a latest flang build for clang64, never ucrt64.
    const ci = { latestMsystrings: new Set(["clang64"]), hasLatest: true };
    expect(
      latestCellCovered(
        "flang/win32[x64][ucrt64]",
        ci.latestMsystrings,
        ci.hasLatest,
      ),
    ).toBe(false);
    expect(
      latestCellCovered(
        "flang/win32[x64][clang64]",
        ci.latestMsystrings,
        ci.hasLatest,
      ),
    ).toBe(true);
  });

  it("flags a [LATEST]-only cell when CI ships no latest entry at all", () => {
    const ci = { latestMsystrings: new Set<string>(), hasLatest: false };
    expect(
      latestCellCovered(
        "flang/win32[x64][ucrt64]",
        ci.latestMsystrings,
        ci.hasLatest,
      ),
    ).toBe(false);
    // ...and a msystem-less cell is likewise uncovered when there is no latest.
    expect(
      latestCellCovered(
        "gfortran/win32[x64][ucrt64]",
        ci.latestMsystrings,
        ci.hasLatest,
      ),
    ).toBe(false);
  });

  it("a msystem-less [LATEST] cell is satisfied by any latest CI entry", () => {
    // Image-only includes (no msystem) only need the compiler to have a latest
    // build somewhere in CI.
    const ci = { latestMsystrings: new Set(["ucrt64"]), hasLatest: true };
    expect(
      latestCellCovered(
        "gfortran/darwin[x64]",
        ci.latestMsystrings,
        ci.hasLatest,
      ),
    ).toBe(true);
    expect(
      latestCellCovered("gfortran/darwin[x64]", new Set<string>(), false),
    ).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Test C: the hand-maintained README "Compiler Support" tables must both
// (a) not over-promise  — every concrete version the README claims (a checkmark
//     on any platform column) is family-supported by the TS SUPPORTED_VERSIONS
//     tables (the runtime source of truth, as in Test B) — and
// (b) not be incomplete — every concrete version the tables actually support
//     is advertised in the README, and a table carrying the `LATEST` marker has
//     a README "latest" row.
// (b) is what catches a *deleted* README row for a still-supported release
// (a deletion that (a) alone never detects, since removing an advert can only
// make the "no over-promise" check stay green).
//
// The README "latest" row itself is excluded from the concrete checks:
// `version: "latest"` always resolves to `versions[0]` (Test A guarantees
// newest-first ordering), and installers such as ifx represent the newest via a
// resolved patch rather than the literal LATEST marker — so "latest" is
// structurally always satisfiable and is only asserted via (b)'s marker check.
//
// Flang is handled identically to Test B (family match): the README lists flang
// as the majors {22..16} and the tables list the same majors, so flang is green
// here; the family rule also bridges any major<->patch/minor spelling
// differences for the other compilers (e.g. README `2026.1.1` is family-covered
// by table `2026.1`, and table `2025.0.4` by README `2025.0`). Matching is
// platform-agnostic (table union across every arch/msystem), mirroring Test
// B's compiler-level check, rather than binding each README column to a
// specific installer leaf.
// ---------------------------------------------------------------------------

const README_COMPILERS = [
  "gfortran",
  "ifx",
  "ifort",
  "nvfortran",
  "aocc",
  "lfortran",
  "flang",
  "armflang",
] as const;

interface ReadmeTable {
  versions: Set<string>; // concrete advertised versions (any checkmark)
  hasLatest: boolean; // a README "latest" row is present for this compiler
}

// Parse the README "Compiler Support" markdown tables into
// {compiler -> ReadmeTable}. Only `### \`compiler\`` sections are read; rows
// with no checkmark and non-table lines are ignored. The `latest` row is
// recorded in `hasLatest` (it is structurally satisfiable; see Test C comment).
function parseReadmeTables(md: string): Record<string, ReadmeTable> {
  const tables: Record<string, ReadmeTable> = {};
  let current: string | undefined;
  const begin = (name: string): ReadmeTable => {
    if (!tables[name]) tables[name] = { versions: new Set(), hasLatest: false };
    return tables[name];
  };
  for (const raw of md.split(/\r?\n/)) {
    const heading = raw.match(/^###\s+`([a-z0-9_-]+)`/i);
    if (heading) {
      const name = heading[1].toLowerCase();
      current = README_COMPILERS.includes(name as never) ? name : undefined;
      if (current) begin(current);
      continue;
    }
    if (!current) continue;
    const row = raw.match(/^\|(.+)\|$/);
    if (!row) continue; // only markdown table rows carry a version claim
    const cols = row[1].split("|").map((c) => c.trim());
    const [first] = cols;
    if (!first || first === "---" || first.toLowerCase() === "version")
      continue;
    if (first.toLowerCase() === "latest") {
      begin(current).hasLatest = true;
      continue;
    }
    if (cols.slice(1).some((c) => c.includes("✓")))
      begin(current).versions.add(first);
  }
  return tables;
}

describe("README compatibility tables match SUPPORTED_VERSIONS (Test C)", () => {
  const advertised = parseReadmeTables(
    fs.readFileSync(path.resolve(__dirname, "../README.md"), "utf8"),
  );

  // Union of every table token (across all archs/msystems) for one compiler —
  // the set a README-advertised version must family-match against.
  const tableUnion = (compiler: string): Set<string> =>
    new Set(
      ALL_VERSION_LISTS.filter((l) =>
        l.label.startsWith(`${compiler}/`),
      ).flatMap((l) => l.versions),
    );

  it("every advertised concrete version is family-supported by the tables", () => {
    const unsupported: Array<{ compiler: string; version: string }> = [];
    for (const compiler of README_COMPILERS) {
      const union = tableUnion(compiler);
      for (const v of advertised[compiler]?.versions ?? []) {
        if (!versionFamilyCovered(v, union)) {
          unsupported.push({ compiler, version: v });
        }
      }
    }
    if (unsupported.length > 0) {
      throw new Error(
        `README advertises versions not supported by SUPPORTED_VERSIONS:\n` +
          unsupported.map((u) => `  - ${u.compiler}: ${u.version}`).join("\n"),
      );
    }
  });

  // (b) Completeness: the README must document every version the tables support.
  // This is what fails when a README row for a still-supported release is
  // deleted — e.g. removing armflang "20.1" while the table still lists it.
  it("every supported concrete version is advertised in the README", () => {
    const unadvertised: Array<{ compiler: string; version: string }> = [];
    for (const compiler of README_COMPILERS) {
      const union = tableUnion(compiler);
      for (const token of union) {
        if (token === LATEST) continue;
        if (
          !versionFamilyCovered(
            token,
            advertised[compiler]?.versions ?? new Set(),
          )
        ) {
          unadvertised.push({ compiler, version: token });
        }
      }
      if (union.has(LATEST) && !advertised[compiler]?.hasLatest) {
        unadvertised.push({ compiler, version: "latest" });
      }
    }
    if (unadvertised.length > 0) {
      throw new Error(
        `SUPPORTED_VERSIONS lists versions not documented in the README:\n` +
          unadvertised.map((u) => `  - ${u.compiler}: ${u.version}`).join("\n"),
      );
    }
  });

  // Negative cases for the README parser itself, so a future README edit that
  // breaks table structure is caught here rather than as a silent no-coverage
  // false-pass.
  it("parseReadmeTables only collects checkmarked concrete versions + latest", () => {
    const md = [
      "### `flang` (LLVM Flang)",
      "",
      "| Version | windows-2025 (ucrt64) | windows-2022 (ucrt64) |",
      "| ------- | --------------------- | --------------------- |",
      "| latest  | ✓                     | ✓                     |",
      "| 16      |                       | ✓                     |",
      "| 15      |                       |                       |",
      "",
      "> Specific patch versions (e.g. `21.1.6`) are supported.",
      "",
      "### Basic Usage",
      "",
      "some prose | not | a | table",
    ].join("\n");
    expect(parseReadmeTables(md)).toEqual({
      flang: { versions: new Set(["16"]), hasLatest: true },
    });
  });
});
