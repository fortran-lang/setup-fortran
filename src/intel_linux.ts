import type { Arch } from "./types";
import { cacheKeySuffix } from "./cache_validation";

// Intel dropped classic icc/icpc after oneAPI 2023.
const CLASSIC_CPP_YEARS = ["2021", "2022", "2023"];

export function hasClassicCpp(bundle: string): boolean {
  return CLASSIC_CPP_YEARS.some((y) => bundle.startsWith(y));
}

export function intelLinuxPackages(bundle: string): [string, string] {
  const cpp = hasClassicCpp(bundle)
    ? "intel-oneapi-compiler-dpcpp-cpp-and-cpp-classic"
    : "intel-oneapi-compiler-dpcpp-cpp";
  return [`intel-oneapi-compiler-fortran-${bundle}`, `${cpp}-${bundle}`];
}

export function intelLinuxCacheKey(arch: Arch, bundle: string): string {
  return `oneapi-linux-validated-v2-${arch}-${bundle}${cacheKeySuffix()}`;
}
