# Setup Fortran

[![Test](https://github.com/awvwgk/setup-fortran/actions/workflows/test.yml/badge.svg)](https://github.com/awvwgk/setup-fortran/actions/workflows/test.yml)

Action to setup a Fortran compiler.

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

This action sets up a Fortran compiler on Ubuntu, MacOS and Windows runners.

```yaml
jobs:
  test:
    runs-on: ${{ matrix.os }}
    strategy:
      fail-fast: false
      matrix:
        os: [ubuntu-latest, macos-latest, windows-latest]
        toolchain:
          - {compiler: gcc, version: 11}
          - {compiler: intel-classic, version: '2021.10'}
        include:
          - os: ubuntu-latest
            toolchain: {compiler: intel, version: '2023.2'}
        exclude:
          - os: windows-latest
            toolchain: {compiler: intel-classic, version: '2021.10'}

    steps:
      - uses: awvwgk/setup-fortran@v1
        id: setup-fortran
        with:
          compiler: ${{ matrix.toolchain.compiler }}
          version: ${{ matrix.toolchain.version }}

      - run: ${{ env.FC }} --version
        env:
          FC: ${{ steps.setup-fortran.outputs.fc }}
```


## Options

- *compiler*: Compiler toolchain to setup, available options are
  - *gcc* (for `gfortran`)
  - *intel* (for `ifx`)
  - *intel-classic* (for `ifort`)
- *version*: Version of the compiler toolchain. See [runner compatibility](#runner-compatibility) chart below.



## Outputs

The action sets the following outputs:

- `cc`: C compiler executable, e.g. `gcc`
- `fc`: Fortran compiler executable, e.g. `gfortran`


## Environment variables

The same values are also set as environment variables:

- `CC`
- `FC`

These are made available to subsequent workflow steps via the [`GITHUB_ENV` environment file mechanism](https://docs.github.com/en/actions/learn-github-actions/environment-variables#passing-values-between-steps-and-jobs-in-a-workflow).


## Runner compatibility

Support for the GCC toolchain varies across GitHub-hosted runner images.

<!-- compat starts -->
| runner       | 6       | 7       | 8       | 9       | 10      | 11      | 12      | 13      |
|:-------------|:--------|:--------|:--------|:--------|:--------|:--------|:--------|:--------|
| macos-11     | &check; | &check; | &check; | &check; | &check; | &check; | &check; | &check; |
| macos-12     | &check; | &check; | &check; | &check; | &check; | &check; | &check; | &check; |
| macos-13     | &check; | &check; | &check; | &check; | &check; | &check; | &check; | &check; |
| ubuntu-20.04 |      | &check; | &check; | &check; | &check; | &check; |      | &check; |
| ubuntu-22.04 |      |      |      | &check; | &check; | &check; | &check; | &check; |
| windows-2019 |      |      | &check; | &check; | &check; | &check; | &check; |      |
| windows-2022 |      |      | &check; | &check; | &check; | &check; | &check; |      |
<!-- compat ends -->

**Note:** version 13 of the GNU toolchain is not yet available on Windows.

Supported Intel toolchains:

| runner    | compiler       | version |
| :-------- | :------------- | :------ |
| ubuntu-\* | intel          | 2023.2, 2023.1, 2023.0, <br/> 2022.2.1, 2022.2, 2022.1, 2022.0, <br/> 2021.4, 2021.3, 2021.2, 2021.1.2, 2021.1 |
| ubuntu-\* | intel-classic  | 2021.10, 2021.9, 2021.8, <br/> 2021.7.1, 2021.7, 2021.6, 2021.5, <br/> 2021.4, 2021.3, 2021.2, 2021.1.2, 2021.1 |
| macos-\*  | intel-classic  | 2021.10, 2021.9, 2021.8, <br/> 2021.7.1, 2021.7, 2021.6, 2021.5, <br/> 2021.4, 2021.3, 2021.2, 2021.1 |
| windows-\* | intel | 2023.2, 2023.1, 2023.0, 2022.2.0, 2022.1.0 |
| windows-\* | intel-classic | 2021.10.0, 2021.9.0, 2021.8.0, 2021.7.0, 2021.6.0 |

**Note:** on macOS the `intel`/`ifx` compiler option is not suppoted, only `intel-classic` with the `ifort` compiler.

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
