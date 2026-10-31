import * as core from "@actions/core";
import * as exec from "@actions/exec";
import * as tc from "@actions/tool-cache";

// Last resort, when the runner's own resolver cannot. On the Intel macOS pool
// (macos-15-intel / macos-26-intel) getaddrinfo intermittently fails to
// resolve registrationcenter-download.intel.com, a CNAME onto Akamai. Flaky,
// not total — in the run that prompted this, 13 of 17 Intel-image ifort jobs
// passed, and for three of the four failures the same version succeeded on
// the other Intel image. Once it has failed on a runner it stays failed,
// because mDNSResponder serves the negative cache.
//
// Resolution moves to HTTPS/443, which is healthy in those same jobs.
// Whether the SERVFAIL seen in the logs came from the resolvers themselves or
// from something answering on port 53 cannot be told from the old log; if it
// is the latter this fixes it, if the former it does not. The error text
// keeps "failed with exit code" (transport) and "returned DNS status"
// (the resolver answered) distinct so the next failure says which.
const DOH_ENDPOINTS = [
  "https://dns.google/resolve",
  "https://cloudflare-dns.com/dns-query",
] as const;

const CURL_BASE_ARGS = [
  "-sS",
  "-L",
  "--fail",
  // The host publishes A records only. Asking for AAAA too doubles the
  // queries and lets a SERVFAIL on the useless AAAA leg fail the lookup.
  "-4",
  "--retry",
  "5",
  "--retry-delay",
  "5",
  // Without this, --retry ignores exit 6 (could not resolve host) and exit 7
  // (could not connect), because curl does not classify them as transient.
  "--retry-all-errors",
  "--retry-max-time",
  "300",
  "--connect-timeout",
  "30",
  "--max-time",
  "600",
] as const;

const IPV4_ADDRESS = /^\d{1,3}(\.\d{1,3}){3}$/;

// --fail, so a 5xx surfaces as an HTTP error instead of a "non-JSON body".
const DOH_CURL_ARGS = [
  "-sS",
  "--fail",
  "-4",
  "--connect-timeout",
  "10",
  "--max-time",
  "20",
] as const;

/**
 * A failure that means "this runner could not turn the hostname into an
 * address", as opposed to a transport problem. Trying the same lookup again
 * on a resolver that has already negatively cached the name will not help,
 * so these short-circuit to the DoH fallback.
 */
function isResolutionFailure(message: string): boolean {
  return /ENOTFOUND|EAI_AGAIN|SERVFAIL|could not resolve host/i.test(message);
}

/**
 * macOS caches negative DNS answers in mDNSResponder. Node's dns.lookup() and
 * curl's threaded resolver both call getaddrinfo(), so once a name has failed
 * on a runner, later attempts in that job are served the cached failure
 * without a query leaving the machine. Flushing forces a re-query.
 */
async function flushDnsCache(): Promise<void> {
  if (process.platform !== "darwin") {
    return;
  }
  await exec.exec("sudo", ["dscacheutil", "-flushcache"], {
    ignoreReturnCode: true,
    silent: true,
  });
  await exec.exec("sudo", ["killall", "-HUP", "mDNSResponder"], {
    ignoreReturnCode: true,
    silent: true,
  });
  core.info("Flushed the system DNS cache.");
}

/**
 * Resolve `host` over DNS-over-HTTPS, via curl rather than fetch so it honours
 * the same proxy environment the rest of this file relies on.
 */
async function dohLookup(
  endpoint: string,
  host: string,
): Promise<readonly string[]> {
  let body = "";
  const exitCode = await exec.exec(
    "curl",
    [
      ...DOH_CURL_ARGS,
      "-H",
      "accept: application/dns-json",
      `${endpoint}?name=${encodeURIComponent(host)}&type=A`,
    ],
    {
      // silent only suppresses the command echo; the stdout listener still
      // receives the body, which is what keeps it out of the log.
      silent: true,
      ignoreReturnCode: true,
      listeners: {
        stdout: (data: Buffer) => {
          body += data.toString();
        },
      },
    },
  );

  if (exitCode !== 0) {
    throw new Error(`${endpoint} failed with exit code ${exitCode.toString()}`);
  }

  let response: {
    Status?: unknown;
    Answer?: unknown;
  };
  try {
    response = JSON.parse(body) as {
      Status?: unknown;
      Answer?: unknown;
    };
  } catch {
    throw new Error(`${endpoint} returned a non-JSON body`);
  }

  // Status is the DNS rcode. 0 is NOERROR; anything else (SERVFAIL, NXDOMAIN)
  // means this provider cannot answer for the name.
  if (typeof response.Status !== "number") {
    throw new Error(`${endpoint} returned a non-JSON body`);
  }
  if (response.Status !== 0) {
    throw new Error(
      `${endpoint} returned DNS status ${response.Status.toString()}`,
    );
  }
  if (response.Answer !== undefined && !Array.isArray(response.Answer)) {
    throw new Error(`${endpoint} response has a malformed Answer`);
  }

  // The answer to a CNAME chain carries A records for the *final* target
  // name, not the queried one, so filter on record type rather than owner.
  const addresses = (
    (response.Answer ?? []) as { type?: unknown; data?: unknown }[]
  )
    .filter((record) => record.type === 1 && typeof record.data === "string")
    .map((record) => record.data as string)
    .filter((data) => IPV4_ADDRESS.test(data));

  if (addresses.length === 0) {
    throw new Error(`${endpoint} returned no A records`);
  }

  return addresses;
}

/**
 * Try each DoH provider in turn, so one provider's outage is not decisive.
 */
async function resolveViaDoh(host: string): Promise<string[]> {
  const failures: string[] = [];

  for (const endpoint of DOH_ENDPOINTS) {
    try {
      return [...(await dohLookup(endpoint, host))];
    } catch (error) {
      failures.push(String(error));
    }
  }

  throw new Error(
    `Could not resolve ${host} over DNS-over-HTTPS (${failures.join("; ")}).`,
  );
}

/**
 * Resolve over DoH, then download with the answer pinned. Returns the error
 * that stopped it, or undefined on success — the caller keeps either way.
 */
async function tryPinnedDownload(
  url: string,
  destPath: string,
  hostname: string,
  effectivePort: string,
): Promise<string | undefined> {
  const maxAttempts = 3;
  let lastError: unknown;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const addresses = await resolveViaDoh(hostname);
      core.info(
        `Resolved ${hostname} to ${addresses.join(", ")} via DNS-over-HTTPS ` +
          `(attempt ${attempt.toString()}/${maxAttempts.toString()}).`,
      );

      // --resolve keeps the original hostname for SNI, the Host header and
      // certificate verification, so this is not the same as fetching by IP.
      await exec.exec("curl", [
        ...CURL_BASE_ARGS,
        "--resolve",
        `${hostname}:${effectivePort}:${addresses.join(",")}`,
        "-o",
        destPath,
        url,
      ]);

      return undefined;
    } catch (error) {
      lastError = error;
      core.info(
        `DNS-over-HTTPS failed (attempt ${attempt.toString()}/${maxAttempts.toString()}): ${String(error)}`,
      );
      if (attempt < maxAttempts) {
        // No DNS flush: DoH and --resolve never touch mDNSResponder.
        await new Promise((resolve) => setTimeout(resolve, 3000 * attempt));
      }
    }
  }

  return String(lastError);
}

export async function downloadInstaller(
  url: string,
  destPath: string,
): Promise<string> {
  const { hostname, port, protocol } = new URL(url);
  const effectivePort =
    port !== "" ? port : protocol === "https:" ? "443" : "80";

  const maxTcAttempts = 3;
  let dohTried = false;
  let lastDohError: string | undefined;

  // The Akamai edge publishes ~20s A TTLs, so tryPinnedDownload resolves
  // immediately before each attempt rather than once up front.
  const tryDoh = async (reason: string): Promise<boolean> => {
    if (dohTried) {
      return false;
    }
    dohTried = true;
    core.info(`${reason} Trying DNS-over-HTTPS...`);
    lastDohError = await tryPinnedDownload(
      url,
      destPath,
      hostname,
      effectivePort,
    );
    return lastDohError === undefined;
  };

  for (let attempt = 1; attempt <= maxTcAttempts; attempt++) {
    try {
      core.info(
        `Downloading via tool-cache (attempt ${attempt.toString()}/${maxTcAttempts.toString()})...`,
      );
      return await tc.downloadTool(url, destPath);
    } catch (error) {
      core.info(
        `tc.downloadTool failed (attempt ${attempt.toString()}/${maxTcAttempts.toString()}): ${String(error)}`,
      );
      // A failed lookup is served from mDNSResponder's negative cache for the
      // rest of the job, so retrying it burns ~130s on a resolver that has
      // already answered. DoH can answer without that cache, usually in a
      // second — but if it fails too, the retries below still run.
      if (isResolutionFailure(String(error))) {
        if (await tryDoh("Name resolution failed.")) {
          return destPath;
        }
      }
      if (attempt < maxTcAttempts) {
        await flushDnsCache();
        await new Promise((resolve) => setTimeout(resolve, 3000 * attempt));
      }
    }
  }

  // Plain curl shares getaddrinfo with tool-cache, so it only helps if the
  // runner's resolver did answer at least once.
  core.info("Falling back to curl...");
  try {
    await exec.exec("curl", [...CURL_BASE_ARGS, "-o", destPath, url]);
    return destPath;
  } catch (error) {
    core.info(`curl failed: ${String(error)}`);
  }

  if (await tryDoh("Retrying against public DNS.")) {
    return destPath;
  }

  throw new Error(
    `Could not download ${url} (DNS-over-HTTPS: ${lastDohError ?? "not tried"}).`,
  );
}
