# Setup Fortran

GitHub action to setup a Fortran compiler on the supported runners.


## Usage

This action allows to setup Fortran compilers on all Ubuntu, MacOS and Windows.

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

- *compiler*: Compiler toolchain to setup,
  available options are *gcc*.

- *version*: Version of the compiler toolchain,
  available options for *gcc* are 11, 10, 9, 8, 7 (Ubuntu and MacOS), 6 (MacOS), 5 (MacOS)


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
