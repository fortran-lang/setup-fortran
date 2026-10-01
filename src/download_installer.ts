import * as core from "@actions/core";
import * as exec from "@actions/exec";
import * as tc from "@actions/tool-cache";
import { Resolver } from "dns/promises";

// Public recursive resolvers, used only when the runner's own resolver has
// failed. Google first: it forwards EDNS Client Subnet, so Akamai hands back
// a geographically sensible edge rather than whatever is near the resolver.
const FALLBACK_NAMESERVERS = ["8.8.8.8", "1.1.1.1", "9.9.9.9"] as const;

const CURL_BASE_ARGS = [
  "-sS",
  "-L",
  "--fail",
  // The Intel download host publishes A records only. Letting getaddrinfo ask
  // for AAAA as well doubles the queries and lets a SERVFAIL on the (useless)
  // AAAA leg fail the whole lookup.
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

/**
 * macOS caches negative DNS answers in mDNSResponder. Node's dns.lookup() and
 * curl's threaded resolver both call getaddrinfo(), so once a name has failed
 * on a runner, every later attempt in that job is served the cached failure
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
 * Resolve `host` with c-ares (bundled in Node) talking straight to public
 * nameservers. This never touches getaddrinfo or mDNSResponder, so it is
 * unaffected by a poisoned system resolver.
 */
async function resolveWithoutSystemResolver(host: string): Promise<string[]> {
  const resolver = new Resolver({ timeout: 5000, tries: 2 });
  resolver.setServers([...FALLBACK_NAMESERVERS]);
  const addresses = await resolver.resolve4(host);
  if (addresses.length === 0) {
    throw new Error(`No A records returned for ${host}.`);
  }
  return addresses;
}

export async function downloadInstaller(
  url: string,
  destPath: string,
): Promise<string> {
  const maxTcAttempts = 3;

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
      if (attempt < maxTcAttempts) {
        await flushDnsCache();
        await new Promise((resolve) => setTimeout(resolve, 3000 * attempt));
      }
    }
  }

  core.info(
    "tc.downloadTool failed after all attempts. Falling back to curl...",
  );
  try {
    await exec.exec("curl", [...CURL_BASE_ARGS, "-o", destPath, url]);
    return destPath;
  } catch (error) {
    core.info(`curl failed: ${String(error)}`);
  }

  // Last resort: assume the runner's resolver is the problem rather than the
  // network. Resolve out of band and pin the result. --resolve keeps the
  // original hostname for SNI, the Host header and certificate verification,
  // so this is not the same as fetching the IP directly.
  const { hostname, port, protocol } = new URL(url);
  const effectivePort =
    port !== "" ? port : protocol === "https:" ? "443" : "80";

  core.info(
    `Could not resolve ${hostname} through the runner's resolver; ` +
      `retrying against public DNS.`,
  );

  const addresses = await resolveWithoutSystemResolver(hostname);
  core.info(`Resolved ${hostname} to ${addresses.join(", ")} via public DNS.`);

  await exec.exec("curl", [
    ...CURL_BASE_ARGS,
    "--resolve",
    `${hostname}:${effectivePort}:${addresses.join(",")}`,
    "-o",
    destPath,
    url,
  ]);

  return destPath;
}
