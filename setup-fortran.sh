#!/usr/bin/env bash

set -ex

install_gcc_brew()
{
  brew install gcc@${version}
  ln -s /usr/local/bin/gfortran-${version} /usr/local/bin/gfortran
  ln -s /usr/local/bin/gcc-${version} /usr/local/bin/gcc
  ln -s /usr/local/bin/g++-${version} /usr/local/bin/g++

  export FC="gfortran"
  export CC="gcc"
  export CXX="g++"
}

install_gcc_apt()
{
  sudo add-apt-repository ppa:ubuntu-toolchain-r/test
  sudo apt-get update
  sudo apt-get install -y gcc-${version} gfortran-${version}
  sudo update-alternatives \
    --install /usr/bin/gcc gcc /usr/bin/gcc-${version} 100 \
    --slave /usr/bin/gfortran gfortran /usr/bin/gfortran-${version} \
    --slave /usr/bin/gcov gcov /usr/bin/gcov-${version}

  export FC="gfortran"
  export CC="gcc"
  export CXX="g++"
}

install_gcc_winlibs()
{
  repo="https://github.com/brechtsanders/winlibs_mingw/releases/download"
  case $version in
    11)
      tag="11.2.0-12.0.1-9.0.0-r1"
      zip="winlibs-x86_64-posix-seh-gcc-11.2.0-mingw-w64-9.0.0-r1.zip"
      ;;
    10)
      tag="10.3.0-12.0.0-9.0.0-r2"
      zip="winlibs-x86_64-posix-seh-gcc-10.3.0-mingw-w64-9.0.0-r2.zip"
      ;;
    9)
      tag="9.4.0-9.0.0-r1"
      zip="winlibs-x86_64-posix-seh-gcc-9.4.0-mingw-w64-9.0.0-r1.zip"
      ;;
    8)
      tag="8.5.0-9.0.0-r1"
      zip="winlibs-x86_64-posix-seh-gcc-8.5.0-mingw-w64-9.0.0-r1.zip"
      ;;
    *)
      exit 1
      ;;
  esac

  if command -v curl > /dev/null 2>&1; then
    fetch="curl -L"
  elif command -v wget > /dev/null 2>&1; then
    FETCH="wget -O -"
  else
    echo "No download mechanism found. Install curl or wget first."
    exit 1
  fi

  $fetch "$repo/$tag/$zip" > gcc.zip
  unzip -qo gcc.zip -d /

  export FC="gfortran"
  export CC="gcc"
  export CXX="g++"
}

compiler=${COMPILER:-gcc}
platform=$(uname -s)

case $compiler in
  gcc)
    version=${VERSION:-9}
    ;;
  *)
    exit 1
    ;;
esac

case $platform in
  Linux*)
    install_gcc_apt
    ;;
  Darwin*)
    install_gcc_brew
    ;;
  MINGW*)
    install_gcc_winlibs
    ;;
  *)
    exit 1
    ;;
esac

which "${FC}"
which "${CC}"

echo "::set-output name=fc::${FC}"
echo "::set-output name=cc::${CC}"
