import type { Arch } from "./types";

export function oneApiLinuxCacheKey(arch: Arch, bundle: string): string {
  return `oneapi-validated-v2-${arch}-${bundle}`;
}
