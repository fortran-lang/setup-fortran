# Setup Fortran

[![Test](https://github.com/awvwgk/setup-fortran/actions/workflows/test.yml/badge.svg)](https://github.com/awvwgk/setup-fortran/actions/workflows/test.yml)

Action to setup a Fortran compiler.


## Usage

This action allows setting up Fortran compilers on Ubuntu, MacOS and Windows runners.

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


## Runner compatibility

<!-- compat starts -->

|                               | 5       | 6       | 7       | 8       | 9       | 10      | 11      | 12      |
|-------------------------------|---------|---------|---------|---------|---------|---------|---------|---------|
| ubuntu-22.04                  |         |         |         |         | &check; | &check; | &check; | &check; |
| ubuntu-20.04 (ubuntu-latest)  |         |         | &check; | &check; | &check; | &check; | &check; |         |
| ubuntu-18.04                  | &check; | &check; | &check; | &check; | &check; | &check; | &check; |         |
| macos-12                      |         | &check; | &check; | &check; | &check; | &check; | &check; | &check; |
| macos-11 (macos-latest)       |         | &check; | &check; | &check; | &check; | &check; | &check; | &check; |
| macos-10.15                   |         | &check; | &check; | &check; | &check; | &check; | &check; | &check; |
| windows-2022 (windows-latest) |         |         |         | &check; | &check; | &check; | &check; | &check; |
| windows-2019                  |         |         |         | &check; | &check; | &check; | &check; | &check; |

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
