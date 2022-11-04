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

    steps:
    - uses: awvwgk/setup-fortran@main
      id: setup-fortran
      with:
        compiler: gcc
        version: 11

    - run: ${{ env.FC }} --version
      env:
        FC: ${{ steps.setup-fortran.outputs.fc }}
```


## Options

- *compiler*: Compiler toolchain to setup, available options are *gcc*
- *version*: Version of the compiler toolchain, available options for *gcc* are *5-12*


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
| runner       | 5       | 6       | 7       | 8       | 9       | 10      | 11      | 12      |
|:-------------|:--------|:--------|:--------|:--------|:--------|:--------|:--------|:--------|
| macos-11     |      | &check; | &check; | &check; | &check; | &check; | &check; | &check; |
| macos-12     |      | &check; | &check; | &check; | &check; | &check; | &check; | &check; |
| ubuntu-18.04 | &check; | &check; | &check; | &check; | &check; | &check; | &check; |      |
| ubuntu-20.04 |      |      | &check; | &check; | &check; | &check; | &check; |      |
| ubuntu-22.04 |      |      |      |      | &check; | &check; | &check; | &check; |
| windows-2019 |      |      |      | &check; | &check; | &check; | &check; | &check; |
| windows-2022 |      |      |      | &check; | &check; | &check; | &check; | &check; |
<!-- compat ends -->


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
