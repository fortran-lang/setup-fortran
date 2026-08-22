import { Arch, OS } from "./types";

export const MINIFORGE_VERSION = "26.3.2-2";

interface MiniforgeInstaller {
  filename: string;
  sha256: string;
  url: string;
}

const INSTALLERS: Record<
  OS,
  Partial<Record<Arch, { filename: string; sha256: string }>>
> = {
  [OS.Linux]: {
    [Arch.X64]: {
      filename: `Miniforge3-${MINIFORGE_VERSION}-Linux-x86_64.sh`,
      sha256:
        "42260ffe3830fb953d5eee1bbb32229ff06aa7c3833c1ed7a9a0420a95685d94",
    },
  },
  [OS.MacOS]: {
    [Arch.X64]: {
      filename: `Miniforge3-${MINIFORGE_VERSION}-MacOSX-x86_64.sh`,
      sha256:
        "a755192103de19bb2782685ac78820c2e00702e5f33e6e4f0a3bf3c214f45d69",
    },
    [Arch.ARM64]: {
      filename: `Miniforge3-${MINIFORGE_VERSION}-MacOSX-arm64.sh`,
      sha256:
        "2657d94152343cff7c06159ac9fc09624d7879fa9575c5a0a324c571c4df0ade",
    },
  },
  [OS.Windows]: {
    [Arch.X64]: {
      filename: `Miniforge3-${MINIFORGE_VERSION}-Windows-x86_64.exe`,
      sha256:
        "088884aafcbf2e3355671d4e9b227b0d1cfb278e3bbe74ba2ad213c553874d70",
    },
  },
};

export function miniforgeInstaller(os: OS, arch: Arch): MiniforgeInstaller {
  const installer = INSTALLERS[os][arch];
  if (!installer) {
    throw new Error(
      `Miniforge ${MINIFORGE_VERSION} is unavailable for ${os} ${arch}.`,
    );
  }

  return {
    ...installer,
    url: `https://github.com/conda-forge/miniforge/releases/download/${MINIFORGE_VERSION}/${installer.filename}`,
  };
}
