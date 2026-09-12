import * as fs from "fs";
import * as path from "path";
import yaml from "js-yaml";

const repoRoot = path.resolve(__dirname, "..");

interface WorkflowJob {
  name?: string;
  uses?: string;
  "runs-on"?: string | string[];
  needs?: string | string[];
  if?: string;
  permissions?: Record<string, string>;
  steps?: unknown[];
  strategy?: unknown;
  "continue-on-error"?: boolean | string;
  [key: string]: unknown;
}

interface Workflow {
  name: string;
  on: Record<string, unknown> | string;
  permissions?: Record<string, string>;
  env?: Record<string, string>;
  jobs: Record<string, WorkflowJob>;
  [key: string]: unknown;
}

function loadWorkflows(): Record<string, Workflow> {
  const workflowDir = path.join(repoRoot, ".github", "workflows");
  const result: Record<string, Workflow> = {};
  for (const file of fs.readdirSync(workflowDir)) {
    if (!file.endsWith(".yml") && !file.endsWith(".yaml")) continue;
    const filePath = path.join(workflowDir, file);
    const content = fs.readFileSync(filePath, "utf-8");
    const doc = yaml.load(content) as Workflow;
    result[file] = doc;
  }
  return result;
}

describe("workflow YAML schema", () => {
  const workflows = loadWorkflows();
  const workflowNames = Object.keys(workflows);

  it("loads all workflow files", () => {
    expect(workflowNames.length).toBeGreaterThan(0);
    expect(workflowNames).toContain("ci.yml");
    expect(workflowNames).toContain("validation.yml");
  });

  for (const [fileName, workflow] of Object.entries(workflows)) {
    describe(fileName, () => {
      it("has a name", () => {
        expect(workflow.name).toBeTruthy();
        expect(typeof workflow.name).toBe("string");
      });

      it("has an 'on' trigger", () => {
        expect(workflow.on).toBeTruthy();
      });

      it("has jobs", () => {
        expect(workflow.jobs).toBeTruthy();
        expect(typeof workflow.jobs).toBe("object");
        expect(Object.keys(workflow.jobs).length).toBeGreaterThan(0);
      });

      for (const [jobId, job] of Object.entries(workflow.jobs)) {
        describe(`job: ${jobId}`, () => {
          it("has runs-on or uses", () => {
            const hasRunner =
              Array.isArray(job["runs-on"]) ||
              typeof job["runs-on"] === "string";
            const hasUses = typeof job.uses === "string";
            expect(hasRunner || hasUses).toBe(true);
          });

          it("does not define both runs-on and uses", () => {
            const hasRunner = job["runs-on"] !== undefined;
            const hasUses = job.uses !== undefined;
            expect(hasRunner && hasUses).toBe(false);
          });

          if (job.uses) {
            const uses = job.uses;
            it("references an existing local reusable workflow", () => {
              expect(uses.startsWith("./")).toBe(true);
              expect(uses.endsWith(".yml") || uses.endsWith(".yaml")).toBe(
                true,
              );
              const refPath = uses.slice(2);
              const resolved = path.resolve(repoRoot, refPath);
              expect(fs.existsSync(resolved)).toBe(true);
            });
          }

          it("does not have duplicate needs", () => {
            if (job.needs) {
              const needs = Array.isArray(job.needs) ? job.needs : [job.needs];
              const unique = new Set(needs);
              expect(unique.size).toBe(needs.length);
            }
          });
        });
      }
    });
  }
});

describe("ci.yml canary structure", () => {
  const ciYml = loadWorkflows()["ci.yml"];

  it("has a weekly schedule trigger", () => {
    const schedule = ciYml.on as Record<string, unknown>;
    expect(schedule).toHaveProperty("schedule");
    const cronList = schedule["schedule"] as Array<{ cron: string }>;
    expect(cronList).toHaveLength(1);
    // Friday at 00:00 UTC: minute=0 hour=0 day=* month=* weekday=5
    const [minute, hour, day, month, weekday] = cronList[0].cron.split(" ");
    expect(minute).toBe("0");
    expect(hour).toBe("0");
    expect(day).toBe("*");
    expect(month).toBe("*");
    expect(weekday).toBe("5");
  });

  it("has a canary-report job", () => {
    expect(ciYml.jobs).toHaveProperty("canary-report");
  });

  it("canary-report job only runs on schedule", () => {
    const canary = ciYml.jobs["canary-report"];
    expect(canary.if).toContain("github.event_name == 'schedule'");
    expect(canary.if).not.toContain("workflow_dispatch");
  });

  it("canary-report has issues write permission", () => {
    const canary = ciYml.jobs["canary-report"];
    expect(canary.permissions).toHaveProperty("issues", "write");
    expect(canary.permissions).toHaveProperty("contents", "read");
  });

  it("canary-report needs all compiler jobs", () => {
    const canary = ciYml.jobs["canary-report"];
    const needs = canary.needs as string[];
    const compilers = [
      "aocc",
      "armflang",
      "gfortran",
      "flang",
      "ifort",
      "ifx",
      "lfortran",
      "nvfortran",
    ];
    for (const c of compilers) {
      expect(needs).toContain(c);
    }
  });

  it("canary-report creates an issue via actions/github-script", () => {
    const canary = ciYml.jobs["canary-report"];
    const steps = canary.steps as Array<{
      uses: string;
      with: { script: string };
    }>;
    expect(steps).toHaveLength(1);
    expect(steps[0].uses).toBe("actions/github-script@v9");
    expect(steps[0].with.script).toContain("github.rest.issues.create");
  });
});
