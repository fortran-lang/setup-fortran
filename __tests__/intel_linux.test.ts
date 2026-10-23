import {
  hasClassicCpp,
  intelLinuxCacheKey,
  intelLinuxPackages,
} from "../src/intel_linux";
import { Arch } from "../src/types";

describe("intel_linux", () => {
  it.each(["2021.1.2", "2022.2.1", "2023.2.4"])(
    "installs classic C/C++ for bundle %s",
    (bundle) => {
      expect(hasClassicCpp(bundle)).toBe(true);
      expect(intelLinuxPackages(bundle)).toEqual([
        `intel-oneapi-compiler-fortran-${bundle}`,
        `intel-oneapi-compiler-dpcpp-cpp-and-cpp-classic-${bundle}`,
      ]);
    },
  );

  it.each(["2024.0", "2024.2", "2025.0", "2099.0"])(
    "installs LLVM-only C/C++ for bundle %s",
    (bundle) => {
      expect(hasClassicCpp(bundle)).toBe(false);
      expect(intelLinuxPackages(bundle)).toEqual([
        `intel-oneapi-compiler-fortran-${bundle}`,
        `intel-oneapi-compiler-dpcpp-cpp-${bundle}`,
      ]);
    },
  );

  it("builds the cache key", () => {
    expect(intelLinuxCacheKey(Arch.X64, "2024.2")).toBe(
      "oneapi-linux-validated-v2-x64-2024.2",
    );
  });
});
