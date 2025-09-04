#!/usr/bin/env bash
set -ex

compiler=${COMPILER:-gcc}
platform=$(uname -s | tr '[:upper:]' '[:lower:]')

if [[ "$RUNNER_OS" == "macOS" ]] && [[ "$compiler" == "intel" ]]; then
  echo "Compiler 'intel' not supported on macOS, falling back to 'intel-classic'"
  compiler="intel-classic"
fi

source ./setup-fortran.sh

case $compiler in
  gcc)
    version=${VERSION:-latest}
    install_gcc $platform
    ;;
  intel-classic)
    version=${VERSION:-2023.2.0}
    install_intel $platform true
    ;;
  intel)
    version=${VERSION:-2025.0}
    install_intel $platform false
    ;;
  nvidia-hpc)
    version=${VERSION:-25.1}
    install_nvidiahpc $platform
    ;;
  lfortran)
    version=${VERSION:-latest}
    install_lfortran $platform
    ;;
  *)
    echo "Compiler '$compiler' not supported. Please check docs."
    exit 1
    ;;
esac
