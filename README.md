# Setup Fortran

[![Test](https://github.com/fortran-lang/setup-fortran/actions/workflows/test.yml/badge.svg)](https://github.com/fortran-lang/setup-fortran/actions/workflows/test.yml)
[![Project Status: Active – The project has reached a stable, usable state and is being actively developed.](https://www.repostatus.org/badges/latest/active.svg)](https://www.repostatus.org/#active)
[![GitHub tag](https://img.shields.io/github/tag/fortran-lang/setup-fortran.svg)](https://github.com/fortran-lang/setup-fortran/tags/latest)


Set up a Fortran compiler on Ubuntu, macOS and Windows runners.

<!-- START doctoc generated TOC please keep comment here to allow auto update -->
<!-- DON'T EDIT THIS SECTION, INSTEAD RE-RUN doctoc TO UPDATE -->

- [Usage](#usage)
- [Options](#options)
- [Outputs](#outputs)
- [Environment variables](#environment-variables)
- [Runner compatibility](#runner-compatibility)
- [License](#license)

<!-- END doctoc generated TOC please keep comment here to allow auto update -->


## Usage

```yaml
jobs:
  test:
    runs-on: ${{ matrix.os }}
    strategy:
      fail-fast: false
      matrix:
        os: [ubuntu-latest, macos-latest, windows-latest]
        toolchain:
          - {compiler: gcc, version: 'latest'}
          - {compiler: intel, version: '2025.0'}
          - {compiler: intel-classic, version: '2021.10'}
          - {compiler: nvidia-hpc, version: 'latest'}
          - {compiler: lfortran, version: '0.45.0'}
          - {compiler: aocc, version: '5.1.0'}
        exclude:
          - os: macos-latest
            toolchain: {compiler: intel}
          - os: macos-latest
            toolchain: {compiler: intel-classic}
          - os: macos-latest
            toolchain: {compiler: nvidia-hpc}
          - os: windows-latest
            toolchain: {compiler: nvidia-hpc}
          - os: macos-latest
            toolchain: {compiler: aocc}
          - os: windows-latest
            toolchain: {compiler: aocc}

    steps:
      - uses: fortran-lang/setup-fortran@v1
        id: setup-fortran
        with:
          compiler: ${{ matrix.toolchain.compiler }}
          version: ${{ matrix.toolchain.version }}

      - run: |
          ${{ env.FC }} ... # environment vars FC, CC, and CXX are set
          ${{ steps.setup-fortran.outputs.fc }} ... # outputs work too
```


## Options

- *compiler*: Compiler toolchain to setup, available options are
  - *gcc* for `gfortran`
  - *intel* for `ifx`
  - *intel-classic* for `ifort`
  - *lfortran* for `lfortran`
  - *nvidia-hpc* for `nvfortran`
  - *aocc* for `flang` (AMD Optimizing C/C++ and Fortran Compilers)
- *version*: Version of the compiler toolchain. See [runner compatibility](#runner-compatibility) charts below.
- *update-environment*: Whether to set environment variables (`FC` etc, defaults true). 


## Outputs

The action sets the following outputs:

- `fc`: Fortran compiler executable, e.g. `gfortran`
- `cc`: C compiler executable, e.g. `gcc`
- `cxx`: C++ compiler executable, e.g. `g++`

C/C++ compilers of the same toolchain/version are provided where available. If a standalone Fortran compiler is selected, the action will attempt to configure compatible C/C++ compilers (typically GCC, or MSVC on Windows), but this is not guaranteed &mdash; use at your own risk.


## Environment variables

The same values are also set as environment variables:

- `FC`
- `CC`
- `CXX`

Corresponding FPM environment variables are also set:

- `FPM_FC`
- `FPM_CC`
- `FPM_CXX`

These are made available to subsequent workflow steps via the [`GITHUB_ENV` environment file mechanism](https://docs.github.com/en/actions/learn-github-actions/environment-variables#passing-values-between-steps-and-jobs-in-a-workflow).


## Runner compatibility

Toolchain support varies across GitHub-hosted runner images.

<!-- compat starts -->
| runner         | aocc 5.1.0   | gcc 13   | gcc 14   | gcc 15   | intel 2021.1   | intel 2021.1.2   | intel 2021.2   | intel 2021.4   | intel 2022.0   | intel 2022.1   | intel 2022.2   | intel 2022.2.1   | intel 2023.0   | intel 2023.1   | intel 2023.2   | intel 2024.0   | intel 2024.1   | intel 2025.0   | intel 2025.2   | intel-classic 2021.1   | intel-classic 2021.1.2   | intel-classic 2021.2   | intel-classic 2021.3   | intel-classic 2021.4   | intel-classic 2021.5   | intel-classic 2021.6   | intel-classic 2021.7.1   | intel-classic 2021.8   | intel-classic 2021.9   | intel-classic 2021.10   | intel-classic 2021.11   | intel-classic 2021.12   | lfortran 0.57.0   | lfortran 0.58.0   | nvidia-hpc 23.3   | nvidia-hpc 23.5   | nvidia-hpc 23.7   | nvidia-hpc 23.9   | nvidia-hpc 23.11   | nvidia-hpc 24.1   | nvidia-hpc 24.3   | nvidia-hpc 24.5   | nvidia-hpc 25.1   | nvidia-hpc 25.3   | nvidia-hpc 25.5   | nvidia-hpc 25.7   | nvidia-hpc 25.9   | nvidia-hpc 26.1   |
|:---------------|:--------------------|:----------------|:----------------|:----------------|:----------------------|:------------------------|:----------------------|:----------------------|:----------------------|:----------------------|:----------------------|:------------------------|:----------------------|:----------------------|:----------------------|:----------------------|:----------------------|:----------------------|:----------------------|:------------------------------|:--------------------------------|:------------------------------|:------------------------------|:------------------------------|:------------------------------|:------------------------------|:--------------------------------|:------------------------------|:------------------------------|:-------------------------------|:-------------------------------|:-------------------------------|:-------------------------|:-------------------------|:-------------------------|:-------------------------|:-------------------------|:-------------------------|:--------------------------|:-------------------------|:-------------------------|:-------------------------|:-------------------------|:-------------------------|:-------------------------|:-------------------------|:-------------------------|:-------------------------|
| macos-14       |                  | &check;         | &check;         | &check;         |                    |                      |                    |                    |                    |                    |                    |                      |                    |                    |                    |                    |                    |                    |                    | &check;                       |                              | &check;                       | &check;                       | &check;                       | &check;                       | &check;                       |                              | &check;                       | &check;                       | &check;                        |                             |                             | &check;                  | &check;                  |                       |                       |                       |                       |                        |                       |                       |                       |                       |                       |                       |                       |                       |                       |
| macos-15       |                  | &check;         | &check;         | &check;         |                    |                      |                    |                    |                    |                    |                    |                      |                    |                    |                    |                    |                    |                    |                    | &check;                       |                              | &check;                       | &check;                       | &check;                       | &check;                       | &check;                       |                              | &check;                       | &check;                       | &check;                        |                             |                             | &check;                  | &check;                  |                       |                       |                       |                       |                        |                       |                       |                       |                       |                       |                       |                       |                       |                       |
| macos-15-intel |                  | &check;         | &check;         | &check;         | &check;               |                      | &check;               | &check;               |                    |                    |                    |                      |                    |                    |                    |                    |                    |                    |                    | &check;                       |                              | &check;                       | &check;                       | &check;                       | &check;                       | &check;                       |                              | &check;                       | &check;                       | &check;                        |                             |                             | &check;                  | &check;                  |                       |                       |                       |                       |                        |                       |                       |                       |                       |                       |                       |                       |                       |                       |
| ubuntu-22.04   |                  | &check;         | &check;         | &check;         | &check;               | &check;                 | &check;               | &check;               | &check;               | &check;               | &check;               | &check;                 | &check;               | &check;               | &check;               | &check;               | &check;               | &check;               | &check;               | &check;                       | &check;                         | &check;                       |                            | &check;                       | &check;                       | &check;                       | &check;                         | &check;                       | &check;                       | &check;                        | &check;                        | &check;                        | &check;                  | &check;                  | &check;                  | &check;                  | &check;                  | &check;                  | &check;                   | &check;                  | &check;                  | &check;                  | &check;                  | &check;                  | &check;                  | &check;                  | &check;                  | &check;                  |
| ubuntu-24.04   | &check;             | &check;         | &check;         | &check;         | &check;               | &check;                 | &check;               | &check;               | &check;               | &check;               | &check;               | &check;                 | &check;               | &check;               | &check;               | &check;               | &check;               | &check;               | &check;               | &check;                       | &check;                         | &check;                       |                            | &check;                       | &check;                       | &check;                       | &check;                         | &check;                       | &check;                       | &check;                        | &check;                        | &check;                        | &check;                  | &check;                  |                       |                       |                       |                       |                        |                       |                       | &check;                  | &check;                  | &check;                  | &check;                  | &check;                  | &check;                  | &check;                  |
| windows-2022   |                  | &check;         | &check;         | &check;         |                    |                      |                    |                    |                    | &check;               | &check;               |                      |                    | &check;               | &check;               | &check;               | &check;               | &check;               | &check;               |                            |                              |                            |                            |                            |                            | &check;                       |                              |                            | &check;                       | &check;                        | &check;                        | &check;                        | &check;                  | &check;                  |                       |                       |                       |                       |                        |                       |                       |                       |                       |                       |                       |                       |                       |                       |
| windows-2025   |                  | &check;         | &check;         | &check;         |                    |                      |                    |                    |                    | &check;               | &check;               |                      |                    | &check;               | &check;               | &check;               | &check;               | &check;               | &check;               |                            |                              |                            |                            |                            |                            | &check;                       |                              |                            | &check;                       | &check;                        | &check;                        | &check;                        | &check;                  | &check;                  |                       |                       |                       |                       |                        |                       |                       |                       |                       |                       |                       |                       |                       |                       |
<!-- compat ends -->

**Note:** Intel's `ifx` compiler is not supported on macOS, so the `intel` option redirects to `intel-classic` (`ifort`).

**Note:** LFortran is currently only discoverable by name with `bash` on Windows, see [here for context](https://github.com/fortran-lang/setup-fortran/pull/57#issuecomment-2021605094).

## License

Licensed under the Apache License, Version 2.0 (the “License”);
you may not use this file except in compliance with the License.
You may obtain a copy of the License at
http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an *“as is” basis*,
*without warranties or conditions of any kind*, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.

Unless you explicitly state otherwise, any contribution intentionally
submitted for inclusion in this project by you, as defined in the
Apache-2.0 license, shall be licensed as above, without any additional
terms or conditions.
