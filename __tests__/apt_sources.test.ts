import { indexFetchFailed } from "../src/apt_sources";

describe("indexFetchFailed", () => {
  it("matches a Failed-to-fetch line for the repository host", () => {
    const output =
      "Hit:1 http://archive.ubuntu.com/ubuntu noble InRelease\n" +
      "E: Failed to fetch https://ppa.launchpadcontent.net/ubuntu-toolchain-r/test/ubuntu/dists/noble/InRelease  503  Service Unavailable\n";
    expect(indexFetchFailed(output, "ppa.launchpad")).toBe(true);
  });

  it("does not combine an unrelated failure with a success line for the host", () => {
    // packages.microsoft.com fails while the PPA index is fetched fine —
    // a whole-output check would read this as a PPA failure.
    const output =
      "Hit:2 https://ppa.launchpadcontent.net/ubuntu-toolchain-r/test/ubuntu noble InRelease\n" +
      "E: Failed to fetch https://packages.microsoft.com/ubuntu/24.04/prod/dists/noble/InRelease  403  Forbidden\n";
    expect(indexFetchFailed(output, "ppa.launchpad")).toBe(false);
  });

  it("returns false when the host is never mentioned", () => {
    const output =
      "E: Failed to fetch https://packages.microsoft.com/ubuntu/24.04/prod/dists/noble/InRelease  403  Forbidden\n";
    expect(indexFetchFailed(output, "ppa.launchpad")).toBe(false);
  });

  it("returns false for empty output", () => {
    expect(indexFetchFailed("", "ppa.launchpad")).toBe(false);
  });

  it("does not match a host that only shares a prefix", () => {
    const output =
      "E: Failed to fetch https://ppa.launchpad.net/some/other/ppa/dists/noble/InRelease  503\n";
    expect(indexFetchFailed(output, "ppa.launchpadcontent.net")).toBe(false);
  });
});
