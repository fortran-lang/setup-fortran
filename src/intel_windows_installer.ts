import * as core from "@actions/core";
import * as exec from "@actions/exec";

// Older oneAPI bootstrappers choke on --components, so they install in full.
const KITS_WITHOUT_COMPONENT_FILTER = new Set([
  "2022.2.0",
  "2022.3.0",
  "2023.1.0",
  "2023.2.0",
]);

// HPC kits bundle MPI, TBB, debuggers and Inspector/ITAC, none of which this
// action exposes. Taking only the Fortran component shrinks the installation
// and its cached copy several times over. The Fortran-only packages are already
// minimal, so there is nothing to prune there.
function isFullKitInstaller(url: string): boolean {
  return /hpckit|hpc-toolkit/i.test(url);
}

function supportsComponentFilter(oneApiRelease: string, url: string): boolean {
  return (
    isFullKitInstaller(url) && !KITS_WITHOUT_COMPONENT_FILTER.has(oneApiRelease)
  );
}

async function resolveFortranComponentId(
  installerPath: string,
): Promise<string | undefined> {
  let output = "";
  await exec.exec(`"${installerPath}"`, ["-s", "-a", "--list-components"], {
    listeners: {
      stdout: (data: Buffer) => {
        output += data.toString();
      },
    },
  });

  const line = output.split("\n").find((l) => /ifort-compiler/i.test(l));
  if (!line) {
    core.info(
      "This installer doesn't expose the Fortran compiler as a separately " +
        "installable component; installing the full kit instead.",
    );
    return undefined;
  }

  const id = line.trim().split(/\s+/)[0];
  if (!id) {
    throw new Error(`Failed to parse component ID from line: "${line}"`);
  }
  return id;
}

// Installer arguments restricting an HPC kit to its Fortran component; empty
// for every other installer. `oneApiRelease` is the oneAPI release the
// installer ships, which the callers source differently: ifort from its
// installer filename, ifx from its release table.
export async function fortranComponentArgs(
  installerPath: string,
  oneApiRelease: string,
  url: string,
): Promise<string[]> {
  if (!supportsComponentFilter(oneApiRelease, url)) return [];
  const componentId = await resolveFortranComponentId(installerPath);
  return componentId ? [`--components=${componentId}`] : [];
}
