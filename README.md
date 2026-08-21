[![GitHub Marketplace](https://img.shields.io/badge/Marketplace-setup--fortran-blueviolet?logo=github)](https://github.com/marketplace/actions/setup-fortran-compilers)
[![GitHub release](https://img.shields.io/github/v/release/minhqdao/setup-fortran?color=orange)](https://github.com/minhqdao/setup-fortran/releases)
[![CI](https://github.com/minhqdao/setup-fortran/actions/workflows/ci.yml/badge.svg)](https://github.com/minhqdao/setup-fortran/actions/workflows/ci.yml)
[![License: Apache-2.0](https://img.shields.io/badge/License-Apache_2.0-blue.svg)](LICENSE)

# setup-fortran

Set up Fortran compiler toolchains for GitHub Actions.
Supports GNU, Intel, LLVM, NVIDIA, AMD, Arm, and LFortran compilers across
Linux, macOS, and Windows.

## Usage

```yaml
- uses: minhqdao/setup-fortran@v1
  with:
    compiler: <compiler>
    version: <version>
```

## Inputs

| Input                | Description                                                                                                                                                    | Default    |
| -------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- |
| `compiler`           | Compiler to install (`gfortran`, `ifx`, `ifort`, `nvfortran`, `aocc`, `lfortran`, `flang`, `armflang`)                                                         | `gfortran` |
| `version`            | Compiler version to install. Enclose the version string in quotation marks (e.g. `"2026.1.1"` or `"0.64.0"`)                                                   | `latest`   |
| `msystem`            | Windows toolchain environment (`native`, `ucrt64`, `clang64`)                                                                                                  | `native`   |
| `cleanup-disk`       | Free up disk space by removing large pre-installed toolkits during `nvfortran` setup (`true`, `false`)                                                         | `false`    |
| `update-environment` | Whether to export toolchain environment variables (`FC`, `CC`, `CXX`, `FPM_*`, `F77`, `F90`, `FORTRAN_COMPILER`) into the runner environment (`true`, `false`) | `true`     |

For compatibility with `fortran-lang/setup-fortran`, the legacy names `gcc`,
`intel`, `intel-classic`, and `nvidia-hpc` are accepted as aliases for
`gfortran`, `ifx`, `ifort`, and `nvfortran`, respectively. Aliases do not
change based on platform; for example, `intel` always resolves to `ifx`.
Use of the canonical names is recommended.

## Compiler Support

### `gfortran`

| Version | ubuntu-24.04 | ubuntu-22.04 | ubuntu-24.04-arm | ubuntu-22.04-arm | macos-26 | macos-26-intel | macos-15 | macos-15-intel | macos-14 | windows-2025 | windows-2022 | windows-2025 (ucrt64) | windows-2022 (ucrt64) |
| ------- | ------------ | ------------ | ---------------- | ---------------- | -------- | -------------- | -------- | -------------- | -------- | ------------ | ------------ | --------------------- | --------------------- |
| latest  | ✓            | ✓            | ✓                | ✓                | ✓        | ✓              | ✓        | ✓              | ✓        | ✓            | ✓            | ✓                     | ✓                     |
| 16      | ✓            | ✓            | ✓                | ✓                | ✓        | ✓              | ✓        | ✓              | ✓        | ✓            | ✓            |                       |                       |
| 15      | ✓            | ✓            | ✓                | ✓                | ✓        | ✓              | ✓        | ✓              | ✓        | ✓            | ✓            |                       |                       |
| 14      | ✓            | ✓            | ✓                | ✓                | ✓        | ✓              | ✓        | ✓              | ✓        | ✓            | ✓            |                       |                       |
| 13      | ✓            | ✓            | ✓                | ✓                | ✓        | ✓              | ✓        | ✓              | ✓        | ✓            | ✓            |                       |                       |
| 12      | ✓            | ✓            | ✓                | ✓                | ✓        | ✓              | ✓        | ✓              | ✓        | ✓            | ✓            |                       |                       |
| 11      | ✓            | ✓            | ✓                | ✓                | ✓        | ✓              | ✓        | ✓              | ✓        | ✓            | ✓            |                       |                       |

---

### `ifx`

| Version  | ubuntu-24.04 | ubuntu-22.04 | windows-2025 | windows-2022 |
| -------- | ------------ | ------------ | ------------ | ------------ |
| latest   | ✓            | ✓            | ✓            | ✓            |
| 2026.1.1 |              |              | ✓            | ✓            |
| 2026.1.0 |              |              | ✓            | ✓            |
| 2026.1   | ✓            | ✓            | ✓            | ✓            |
| 2026.0   | ✓            | ✓            | ✓            | ✓            |
| 2025.3.3 |              |              | ✓            | ✓            |
| 2025.3.2 |              |              | ✓            | ✓            |
| 2025.3.1 |              |              | ✓            | ✓            |
| 2025.3.0 |              |              | ✓            | ✓            |
| 2025.3   | ✓            | ✓            | ✓            | ✓            |
| 2025.2.1 |              |              | ✓            | ✓            |
| 2025.2.0 |              |              | ✓            | ✓            |
| 2025.2   | ✓            | ✓            | ✓            | ✓            |
| 2025.1.0 |              |              | ✓            | ✓            |
| 2025.1   | ✓            | ✓            | ✓            | ✓            |
| 2025.0.0 |              |              | ✓            | ✓            |
| 2025.0   | ✓            | ✓            | ✓            | ✓            |
| 2024.2.1 |              |              | ✓            | ✓            |
| 2024.2.0 |              |              | ✓            | ✓            |
| 2024.2   | ✓            | ✓            | ✓            | ✓            |
| 2024.1.0 |              |              | ✓            | ✓            |
| 2024.1   | ✓            | ✓            | ✓            | ✓            |
| 2024.0.2 |              |              | ✓            | ✓            |
| 2024.0.1 |              |              | ✓            | ✓            |
| 2024.0   | ✓            | ✓            | ✓            | ✓            |
| 2023.2.4 | ✓            | ✓            |              |              |
| 2023.2.3 | ✓            | ✓            |              |              |
| 2023.2.2 | ✓            | ✓            |              |              |
| 2023.2.1 | ✓            | ✓            | ✓            | ✓            |
| 2023.2.0 | ✓            | ✓            | ✓            | ✓            |
| 2023.2   | ✓            | ✓            | ✓            | ✓            |
| 2023.1.0 | ✓            | ✓            | ✓            | ✓            |
| 2023.1   | ✓            | ✓            | ✓            | ✓            |
| 2023.0.0 | ✓            | ✓            |              |              |
| 2023.0   | ✓            | ✓            |              |              |
| 2022.3.0 |              |              | ✓            | ✓            |
| 2022.3   |              |              | ✓            | ✓            |
| 2022.2.1 | ✓            | ✓            |              |              |
| 2022.2.0 | ✓            | ✓            | ✓            | ✓            |
| 2022.2   | ✓            | ✓            | ✓            | ✓            |
| 2022.1.0 | ✓            | ✓            |              |              |
| 2022.1   | ✓            | ✓            |              |              |
| 2022.0.2 | ✓            | ✓            |              |              |
| 2022.0.1 | ✓            | ✓            |              |              |
| 2022.0   | ✓            | ✓            |              |              |
| 2021.4.0 | ✓            | ✓            |              |              |
| 2021.4   | ✓            | ✓            |              |              |
| 2021.3.0 | ✓            | ✓            |              |              |
| 2021.3   | ✓            | ✓            |              |              |
| 2021.2.0 | ✓            | ✓            |              |              |
| 2021.2   | ✓            | ✓            |              |              |
| 2021.1.2 | ✓            | ✓            |              |              |
| 2021.1.1 | ✓            | ✓            |              |              |
| 2021.1   | ✓            | ✓            |              |              |

> In 2022, `ifx` compiler version numbers differed from release numbers. Specify the compiler version here, not the release number.

---

### `ifort`

| Version  | ubuntu-24.04 | ubuntu-22.04 | macos-26-intel | macos-15-intel | windows-2025 | windows-2022 |
| -------- | ------------ | ------------ | -------------- | -------------- | ------------ | ------------ |
| latest   | ✓            | ✓            | ✓              | ✓              | ✓            | ✓            |
| 2021.13  | ✓            | ✓            |                |                | ✓            | ✓            |
| 2021.12  | ✓            | ✓            |                |                | ✓            | ✓            |
| 2021.11  | ✓            | ✓            |                |                | ✓            | ✓            |
| 2021.10  | ✓            | ✓            | ✓              | ✓              | ✓            | ✓            |
| 2021.9   | ✓            | ✓            | ✓              | ✓              | ✓            | ✓            |
| 2021.8   | ✓            | ✓            | ✓              | ✓              |              |              |
| 2021.7.1 | ✓            | ✓            |                |                |              |              |
| 2021.7   | ✓            | ✓            |                |                | ✓            | ✓            |
| 2021.6   | ✓            | ✓            | ✓              | ✓              | ✓            | ✓            |
| 2021.5   | ✓            | ✓            | ✓              | ✓              |              |              |
| 2021.4   | ✓            | ✓            |                |                |              |              |
| 2021.3   | ✓            | ✓            | ✓              | ✓              |              |              |
| 2021.2   | ✓            | ✓            | ✓              | ✓              |              |              |
| 2021.1.2 | ✓            | ✓            |                |                |              |              |
| 2021.1   | ✓            | ✓            | ✓              | ✓              |              |              |

---

### `nvfortran`

| Version | ubuntu-24.04 | ubuntu-22.04 | ubuntu-24.04-arm | ubuntu-22.04-arm |
| ------- | ------------ | ------------ | ---------------- | ---------------- |
| latest  | ✓            | ✓            | ✓                | ✓                |
| 26.5    | ✓            | ✓            | ✓                | ✓                |
| 26.3    | ✓            | ✓            | ✓                | ✓                |
| 26.1    | ✓            | ✓            | ✓                | ✓                |
| 25.11   | ✓            | ✓            | ✓                | ✓                |
| 25.9    | ✓            | ✓            | ✓                | ✓                |
| 25.7    | ✓            | ✓            | ✓                | ✓                |
| 25.5    | ✓            | ✓            | ✓                | ✓                |
| 25.3    | ✓            | ✓            | ✓                | ✓                |
| 25.1    | ✓            | ✓            | ✓                | ✓                |
| 24.11   | ✓            | ✓            | ✓                | ✓                |
| 24.9    | ✓            | ✓            | ✓                | ✓                |
| 24.7    | ✓            | ✓            | ✓                | ✓                |
| 24.5    | ✓            | ✓            | ✓                | ✓                |
| 24.3    | ✓            | ✓            | ✓                | ✓                |
| 24.1    | ✓            | ✓            | ✓                | ✓                |
| 23.11   | ✓            | ✓            | ✓                | ✓                |
| 23.9    | ✓            | ✓            | ✓                | ✓                |
| 23.7    | ✓            | ✓            | ✓                | ✓                |
| 23.5    | ✓            | ✓            | ✓                | ✓                |
| 23.3    | ✓            | ✓            | ✓                | ✓                |
| 23.1    | ✓            | ✓            | ✓                | ✓                |
| 22.11   | ✓            | ✓            | ✓                | ✓                |
| 22.9    | ✓            | ✓            | ✓                | ✓                |
| 22.7    | ✓            | ✓            | ✓                | ✓                |
| 22.5    | ✓            | ✓            | ✓                | ✓                |
| 22.3    | ✓            | ✓            | ✓                | ✓                |
| 22.2    | ✓            | ✓            | ✓                | ✓                |
| 22.1    | ✓            | ✓            | ✓                | ✓                |
| 21.11   | ✓            | ✓            | ✓                | ✓                |
| 21.9    | ✓            | ✓            | ✓                | ✓                |
| 21.7    | ✓            | ✓            | ✓                | ✓                |
| 21.5    | ✓            | ✓            | ✓                | ✓                |
| 21.3    | ✓            | ✓            | ✓                | ✓                |
| 21.2    | ✓            | ✓            | ✓                | ✓                |
| 21.1    | ✓            | ✓            | ✓                | ✓                |
| 20.11   | ✓            | ✓            | ✓                | ✓                |
| 20.9    | ✓            | ✓            | ✓                | ✓                |
| 20.7    | ✓            | ✓            | ✓                | ✓                |

---

### `aocc`

| Version | ubuntu-24.04 | ubuntu-22.04 |
| ------- | ------------ | ------------ |
| latest  | ✓            | ✓            |
| 5.2     | ✓            | ✓            |
| 5.1     | ✓            | ✓            |
| 5.0     | ✓            | ✓            |
| 4.2     | ✓            | ✓            |
| 4.1     | ✓            | ✓            |

---

### `lfortran`

| Version | ubuntu-24.04 | ubuntu-22.04 | macos-26 | macos-26-intel | macos-15 | macos-15-intel | macos-14 | windows-2025 | windows-2022 | windows-2025 (ucrt64) | windows-2022 (ucrt64) | windows-2025 (clang64) | windows-2022 (clang64) |
| ------- | ------------ | ------------ | -------- | -------------- | -------- | -------------- | -------- | ------------ | ------------ | --------------------- | --------------------- | ---------------------- | ---------------------- |
| latest  | ✓            | ✓            | ✓        | ✓              | ✓        | ✓              | ✓        | ✓            | ✓            | ✓                     | ✓                     | ✓                      | ✓                      |
| 0.64.0  | ✓            | ✓            | ✓        | ✓              | ✓        | ✓              | ✓        | ✓            | ✓            |                       |                       |                        |                        |
| 0.63.0  | ✓            | ✓            | ✓        | ✓              | ✓        | ✓              | ✓        | ✓            | ✓            |                       |                       |                        |                        |
| 0.62.0  | ✓            | ✓            | ✓        | ✓              | ✓        | ✓              | ✓        | ✓            | ✓            |                       |                       |                        |                        |
| 0.61.0  | ✓            | ✓            | ✓        | ✓              | ✓        | ✓              | ✓        | ✓            | ✓            |                       |                       |                        |                        |
| 0.60.0  | ✓            | ✓            | ✓        | ✓              | ✓        | ✓              | ✓        | ✓            | ✓            |                       |                       |                        |                        |
| 0.59.0  | ✓            | ✓            | ✓        | ✓              | ✓        | ✓              | ✓        | ✓            | ✓            |                       |                       |                        |                        |
| 0.58.0  | ✓            | ✓            | ✓        | ✓              | ✓        | ✓              | ✓        | ✓            | ✓            |                       |                       |                        |                        |
| 0.57.0  | ✓            | ✓            | ✓        | ✓              | ✓        | ✓              | ✓        | ✓            | ✓            |                       |                       |                        |                        |

---

### `flang` (LLVM Flang)

| Version | ubuntu-24.04 | ubuntu-22.04 | ubuntu-24.04-arm | ubuntu-22.04-arm | macos-26 | macos-26-intel | macos-15 | macos-15-intel | macos-14 | windows-2025 | windows-2022 | windows-11-arm | windows-2025 (ucrt64) | windows-2022 (ucrt64) | windows-2025 (clang64) | windows-2022 (clang64) |
| ------- | ------------ | ------------ | ---------------- | ---------------- | -------- | -------------- | -------- | -------------- | -------- | ------------ | ------------ | -------------- | --------------------- | --------------------- | ---------------------- | ---------------------- |
| latest  | ✓            | ✓            | ✓                | ✓                | ✓        | ✓              | ✓        | ✓              | ✓        | ✓            | ✓            | ✓              | ✓                     | ✓                     | ✓                      | ✓                      |
| 22      | ✓            | ✓            | ✓                | ✓                |          |                |          |                |          | ✓            | ✓            | ✓              |                       |                       |                        |                        |
| 21      | ✓            | ✓            | ✓                | ✓                | ✓        |                | ✓        |                |          |              |              | ✓              |                       |                       |                        |                        |
| 20      | ✓            | ✓            | ✓                | ✓                | ✓        |                | ✓        |                |          |              |              | ✓              |                       |                       |                        |                        |
| 19      | ✓            | ✓            | ✓                | ✓                | ✓        | ✓              | ✓        | ✓              |          |              |              |                |                       |                       |                        |                        |
| 18      | ✓            | ✓            | ✓                | ✓                |          |                |          |                |          |              |              |                |                       |                       |                        |                        |
| 17      | ✓            | ✓            | ✓                | ✓                |          |                |          |                |          |              |              |                |                       |                       |                        |                        |
| 16      |              | ✓            |                  |                  |          |                |          |                |          |              |              |                |                       |                       |                        |                        |

> Specific patch versions (e.g. `21.1.6`) are supported on macOS and native
> Windows runners and validated against available GitHub releases. Patch
> versions are not individually tested.

---

### `armflang` (Arm Toolchain for Linux)

| Version | ubuntu-24.04-arm | ubuntu-22.04-arm |
| ------- | ---------------- | ---------------- |
| latest  | ✓                | ✓                |
| 22.1    | ✓                | ✓                |
| 21.1    | ✓                | ✓                |
| 20.1    | ✓                | ✓                |

---

## Examples

### Basic Usage

```yaml
steps:
  - uses: actions/checkout@v7
  - uses: minhqdao/setup-fortran@v1
  - run: ${{ env.FC }} hello.f90
```

If omitted, `compiler` defaults to `gfortran` and `version` to the latest
supported version for the platform.

### Specific Version

```yaml
- uses: minhqdao/setup-fortran@v1
  with:
    compiler: lfortran
    version: "0.64.0"
```

### Matrix Build

```yaml
strategy:
  matrix:
    os: [ubuntu-latest, macos-latest, windows-latest]
    toolchain:
      - { compiler: gfortran, version: "15" }
      - { compiler: ifx, version: "2026.1" }
      - { compiler: lfortran, version: "0.64.0" }
    exclude:
      - os: macos-latest
        toolchain: { compiler: ifx, version: "2026.1" }
    include:
      - os: windows-11-arm
        toolchain: { compiler: flang, version: "22" }
jobs:
  test:
    runs-on: ${{ matrix.os }}
    steps:
      - uses: actions/checkout@v7
      - uses: minhqdao/setup-fortran@v1
        with:
          compiler: ${{ matrix.toolchain.compiler }}
          version: ${{ matrix.toolchain.version }}
      - run: ${{ env.FC }} hello.f90
```

### Windows with MSYS2

```yaml
- uses: minhqdao/setup-fortran@v1
  with:
    compiler: lfortran
    msystem: ucrt64
```

## Outputs

| Output    | Description                                |
| --------- | ------------------------------------------ |
| `version` | Resolved version of the installed compiler |
| `fc`      | Command or path to the Fortran compiler    |
| `cc`      | Command or path to the C compiler          |
| `cxx`     | Command or path to the C++ compiler        |

## Environment Variables

| Variable  | Description                                              |
| --------- | -------------------------------------------------------- |
| `FC`      | Command or path to the Fortran compiler                  |
| `CC`      | Command or path to the C compiler                        |
| `CXX`     | Command or path to the C++ compiler                      |
| `FPM_FC`  | Command or path to the Fortran compiler for fpm          |
| `FPM_CC`  | Command or path to the C compiler for fpm                |
| `FPM_CXX` | Command or path to the C++ compiler for fpm              |
| `F77`     | Command or path to the Fortran compiler (alias for `FC`) |
| `F90`     | Command or path to the Fortran compiler (alias for `FC`) |

## Migration Guide

Migrating from `fortran-lang/setup-fortran` to `minhqdao/setup-fortran` requires only a few changes:

- The legacy compiler names `gcc`, `intel`, `intel-classic`, and `nvidia-hpc` remain supported as compatibility aliases. Migrating to the canonical names is recommended.
- `ifx` configurations on macOS were previously redirected to `ifort`. This behavior is no longer supported; `ifx` on macOS will fail. Remove these configurations from your workflow matrices.
- For some 2022 `ifx` releases, the release number differed from the compiler version number. For example, `2022.1` on Windows installed compiler version `2022.2.0`. Compiler versions are used consistently here, so `2022.1` is no longer listed as a supported version. Use `2022.2.0` instead.

## Development

Run `npm run all` to format and lint the source, run unit tests, bundle the
action into `dist`, and run the smoke tests.

Commit changes to `dist` together with the source changes, as GitHub Actions
executes the bundled code from this directory.

## Reporting Issues

Report bugs and feature requests in the [issue tracker](https://github.com/minhqdao/setup-fortran/issues).

## License

[Apache-2.0](LICENSE)
