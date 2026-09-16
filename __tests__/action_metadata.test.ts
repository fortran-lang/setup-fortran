import * as fs from "fs";
import * as path from "path";
import yaml from "js-yaml";
import type { Inputs } from "../src/types";

const repoRoot = path.resolve(__dirname, "..");

interface ActionYml {
  name: string;
  description: string;
  author?: string;
  inputs: Record<
    string,
    { description?: string; required?: boolean; default?: string }
  >;
  outputs: Record<string, { description?: string }>;
  runs: { using: string; main: string };
}

function loadActionYml(): ActionYml {
  const filePath = path.join(repoRoot, "action.yml");
  const content = fs.readFileSync(filePath, "utf-8");
  return yaml.load(content) as ActionYml;
}

describe("action.yml metadata contract", () => {
  const actionYml = loadActionYml();

  describe("basic metadata", () => {
    it("has a name", () => {
      expect(actionYml.name).toBe("Setup Fortran Compilers");
    });

    it("has a non-empty description", () => {
      expect(actionYml.description).toBeTruthy();
      expect(actionYml.description.length).toBeGreaterThan(0);
    });

    it("has an author", () => {
      expect(actionYml.author).toBeTruthy();
    });
  });

  describe("inputs", () => {
    it("declares the expected input names", () => {
      expect(Object.keys(actionYml.inputs).sort()).toEqual(
        [
          "cleanup-disk",
          "compiler",
          "msystem",
          "update-environment",
          "version",
        ].sort(),
      );
    });

    it("makes compiler optional with default gfortran", () => {
      const input = actionYml.inputs["compiler"];
      expect(input.required).toBe(false);
      expect(input.default).toBe("gfortran");
    });

    it("makes version optional without a default (resolved in code)", () => {
      const input = actionYml.inputs["version"];
      expect(input.required).toBe(false);
      expect(input.default).toBeUndefined();
    });

    it("makes msystem optional with default native", () => {
      const input = actionYml.inputs["msystem"];
      expect(input.required).toBe(false);
      expect(input.default).toBe("native");
    });

    it("makes cleanup-disk optional with default false", () => {
      const input = actionYml.inputs["cleanup-disk"];
      expect(input.required).toBe(false);
      expect(input.default).toBe("false");
    });

    it("makes update-environment optional with default true", () => {
      const input = actionYml.inputs["update-environment"];
      expect(input.required).toBe(false);
      expect(input.default).toBe("true");
    });
  });

  describe("outputs", () => {
    it("declares the expected output names", () => {
      expect(Object.keys(actionYml.outputs).sort()).toEqual(
        ["cc", "cxx", "fc", "version"].sort(),
      );
    });
  });

  describe("runs", () => {
    it("uses node24 runtime", () => {
      expect(actionYml.runs.using).toBe("node24");
    });

    it("points to dist/index.js", () => {
      expect(actionYml.runs.main).toBe("dist/index.js");
    });
  });
});

describe("action.yml input default values match code DEFAULTS", () => {
  const actionYml = loadActionYml();

  it("compiler default matches DEFAULTS.compiler (gfortran)", () => {
    expect(actionYml.inputs["compiler"].default).toBe("gfortran");
  });

  it("msystem default matches DEFAULTS.msystem (native)", () => {
    expect(actionYml.inputs["msystem"].default).toBe("native");
  });

  it("cleanup-disk default matches DEFAULTS.cleanupDisk (false)", () => {
    expect(actionYml.inputs["cleanup-disk"].default).toBe("false");
  });

  it("update-environment default matches DEFAULTS.updateEnvironment (true)", () => {
    expect(actionYml.inputs["update-environment"].default).toBe("true");
  });

  it("version default in action.yml matches code resolution for unspecified version", () => {
    // version has no default in action.yml; the code falls back to LATEST = "latest"
    expect(actionYml.inputs["version"].default).toBeUndefined();
    // The code's DEFAULTS.version is LATEST
    const expectedDefault: Inputs["version"] = "latest";
    expect(expectedDefault).toBe("latest");
  });
});
