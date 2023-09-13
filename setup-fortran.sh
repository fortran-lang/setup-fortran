#!/usr/bin/env bash

set -ex

require_fetch()
{
  if command -v curl > /dev/null 2>&1; then
    fetch="curl -L"
  elif command -v wget > /dev/null 2>&1; then
    fetch="wget -O -"
  else
    echo "No download mechanism found. Install curl or wget first."
    exit 1
  fi
}


install_gcc_brew()
{
  brew install gcc@${version}
  ln -fs /usr/local/bin/gfortran-${version} /usr/local/bin/gfortran
  ln -fs /usr/local/bin/gcc-${version} /usr/local/bin/gcc
  ln -fs /usr/local/bin/g++-${version} /usr/local/bin/g++

  # link lib dir for previous GCC versions to avoid missing .dylib issues
  for (( i=13; i>4; i-- ))
  do
    gcc_lib_path="/usr/local/opt/gcc/lib/gcc/$i"
    if [ -d $gcc_lib_path ]; then
      echo "found $gcc_lib_path"
      for (( j=$i; j>4; j-- ))
      do
        ln -fs /usr/local/opt/gcc/lib/gcc/$i /usr/local/opt/gcc/lib/gcc/$j
      done
      break
    fi
  done

  export FC="gfortran"
  export CC="gcc"
  export CXX="g++"
}

install_gcc_apt()
{
  sudo add-apt-repository --yes ppa:ubuntu-toolchain-r/test
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

install_gcc_choco()
{
  case $version in
    12)
      choco install mingw --version 12.2.0 --force
      ;;
    11)
      choco install mingw --version 11.2.0 --force
      ;;
    10)
      choco install mingw --version 10.3.0 --force
      ;;
    9)
      choco install mingw --version 9.4.0 --force
      ;;
    8)
      choco install mingw --version 8.5.0 --force
      ;;
    *)
      echo "Unsupported version: $version (choose 8-12)"
      exit 1
      ;;
  esac

  export FC="gfortran"
  export CC="gcc"
  export CXX="g++"

  # missing DLL can cause successfully compiled executables to fail at runtime
  FCDIR=/c/ProgramData/Chocolatey/bin
  LNDIR=/c/ProgramData/Chocolatey/lib/mingw/tools/install/mingw64/bin
  if [ -d "$FCDIR" ] && [ -f "$LNDIR/libgfortran-5.dll" ] && [ ! -f "$FCDIR/libgfortran-5.dll" ]; then
      ln -s "$LNDIR/libgfortran-5.dll" "$FCDIR/libgfortran-5.dll"
  fi
}

install_gcc()
{
  local platform=$1
  case $platform in
    linux*)
      install_gcc_apt
      ;;
    darwin*)
      install_gcc_brew
      ;;
    mingw*)
      install_gcc_choco
      ;;
    msys*)
      install_gcc_choco
      ;;
    cygwin*)
      install_gcc_choco
      ;;
    *)
      echo "Unsupported platform: $platform"
      exit 1
      ;;
  esac
}

export_intel_vars()
{
  cat >> $GITHUB_ENV <<EOF
LD_LIBRARY_PATH=$LD_LIBRARY_PATH
LIBRARY_PATH=$LIBRARY_PATH
INFOPATH=$INFOPATH
MANPATH=$MANPATH
ONEAPI_ROOT=$ONEAPI_ROOT
CLASSPATH=$CLASSPATH
CMAKE_PREFIX_PATH=$CMAKE_PREFIX_PATH
OCL_ICD_FILENAMES=$OCL_ICD_FILENAMES
INTEL_PYTHONHOME=$INTEL_PYTHONHOME
CPATH=$CPATH
EOF
  for path in ${PATH//:/ }; do
    echo $path >> $GITHUB_PATH
  done
}

intel_version_map_l()
{
  local actual_version=$1
  local classic=$2
  if $classic; then
    case $actual_version in
      2021.10.0 | 2021.10)
        version=2023.2.0
        ;;
      2021.9.0 | 2021.9)
        version=2023.1.0
        ;;
      2021.8.0 | 2021.8)
        version=2023.0.0
        ;;
      2021.7.1)
        version=2022.2.1
        ;;
      2021.7.0 | 2021.7)
        version=2022.2.0
        ;;
      2021.6.0 | 2021.6)
        version=2022.1.0
        ;;
      2021.5.0 | 2021.5)
        version=2022.0.2
        # version=2022.0.1
        ;;
      2021.4 | 2021.3 | 2021.2)
        version=$actual_version.0
        ;;
      2021.1)
        version=2021.1.1
        ;;
      *)
        version=$actual_version
        ;;
    esac
  else
    case $actual_version in
      2022.0.0 | 2022.0)
        version=2022.0.2
        ;;
      2023.2 | 2023.1 | 2023.0 | 2022.2 | 2022.1 | 2021.4 | 2021.3 | 2021.2)
        version=$actual_version.0
        ;;
      2021.1)
        version=2021.1.1
        ;;
      *)
        version=$actual_version
        ;;
    esac
  fi
}

intel_version_map_m()
{
  local actual_version=$1
  case $actual_version in
    2021.10.0 | 2021.10)
      version=2023.2.0
      ;;
    2021.9.0 | 2021.9)
      version=2023.1.0
      ;;
    2021.8.0 | 2021.8)
      version=2023.0.0
      ;;
    2021.7.1)
      version=2022.3.1
      ;;
    2021.7.0 | 2021.7)
      version=2022.3.0
      ;;
    2021.6.0 | 2021.6)
      version=2022.2.0
      ;;
    2021.5.0 | 2021.5)
      version=2022.1.0
      ;;
    2021.4 | 2021.3 | 2021.2 | 2021.1)
      version=$actual_version.0
      ;;
    *)
      version=$actual_version
      ;;
  esac
}

intel_version_map_w()
{
  local actual_version=$1
  local classic=$2
  if $classic; then
    case $actual_version in
      2021.10.0 | 2021.10)
        version=2023.2.0
        ;;
      2021.9.0 | 2021.9)
        version=2023.1.0
        ;;
      2021.8.0 | 2021.8)
        version=2023.0.0
        ;;
      2021.7.0 | 2021.7)
        version=2022.3.0
        ;;
      2021.6.0 | 2021.6)
        version=2022.2.0
        ;;
      *)
        version=$actual_version
        ;;
    esac
  else
    case $actual_version in
      2023.2 | 2023.1 | 2023.0)
        version=$actual_version.0
        ;;
      2022.2.0 | 2022.2)
        version=2022.3.0
        ;;
      2022.1.0 | 2022.1)
        version=2022.2.0
        ;;
      *)
        version=$actual_version
        ;;
    esac
  fi
}

install_intel_apt()
{
  local version=$1
  local classic=$2
  intel_version_map_l $version $classic

  require_fetch
  local _KEY="GPG-PUB-KEY-INTEL-SW-PRODUCTS-2023.PUB"
  $fetch https://apt.repos.intel.com/intel-gpg-keys/$_KEY > $_KEY
  sudo apt-key add $_KEY
  rm $_KEY
  unset $_KEY
  echo "deb https://apt.repos.intel.com/oneapi all main" \
    | sudo tee /etc/apt/sources.list.d/oneAPI.list
  sudo apt-get update

  sudo apt-get install \
    intel-oneapi-compiler-{fortran,dpcpp-cpp-and-cpp-classic}-$version intel-oneapi-mkl

  source /opt/intel/oneapi/setvars.sh
  export_intel_vars

  if $classic; then
    export FC="ifort"
    export CC="icc"
    export CXX="icpc"
  else
    export FC="ifx"
    export CC="icx"
    export CXX="icpx"
  fi
}

install_intel_dmg()
{
  local version=$1
  intel_version_map_m $version

  case $version in
    2021.1.0)
      MACOS_BASEKIT_URL=https://registrationcenter-download.intel.com/akdlm/irc_nas/17426/m_BaseKit_p_2021.1.0.2427.dmg
      MACOS_HPCKIT_URL=https://registrationcenter-download.intel.com/akdlm/irc_nas/17398/m_HPCKit_p_2021.1.0.2681.dmg
      ;;
    2021.2.0)
      MACOS_BASEKIT_URL=https://registrationcenter-download.intel.com/akdlm/irc_nas/17714/m_BaseKit_p_2021.2.0.2855.dmg
      MACOS_HPCKIT_URL=https://registrationcenter-download.intel.com/akdlm/irc_nas/17643/m_HPCKit_p_2021.2.0.2903.dmg
      ;;
    2021.3.0)
      MACOS_BASEKIT_URL=https://registrationcenter-download.intel.com/akdlm/irc_nas/17969/m_BaseKit_p_2021.3.0.3043.dmg
      MACOS_HPCKIT_URL=https://registrationcenter-download.intel.com/akdlm/irc_nas/17890/m_HPCKit_p_2021.3.0.3226.dmg
      ;;
    2021.4.0)
      MACOS_BASEKIT_URL=https://registrationcenter-download.intel.com/akdlm/irc_nas/18256/m_BaseKit_p_2021.4.0.3384.dmg
      MACOS_HPCKIT_URL=https://registrationcenter-download.intel.com/akdlm/irc_nas/18242/m_HPCKit_p_2021.4.0.3389.dmg
      ;;
    2022.1.0)
      MACOS_BASEKIT_URL=https://registrationcenter-download.intel.com/akdlm/irc_nas/18342/m_BaseKit_p_2022.1.0.92.dmg
      MACOS_HPCKIT_URL=https://registrationcenter-download.intel.com/akdlm/irc_nas/18341/m_HPCKit_p_2022.1.0.86.dmg
      ;;
    2022.2.0)
      MACOS_BASEKIT_URL=https://registrationcenter-download.intel.com/akdlm/IRC_NAS/18675/m_BaseKit_p_2022.2.0.226_offline.dmg
      MACOS_HPCKIT_URL=https://registrationcenter-download.intel.com/akdlm/IRC_NAS/18681/m_HPCKit_p_2022.2.0.158_offline.dmg
      ;;
    2022.3.0)
      MACOS_BASEKIT_URL=https://registrationcenter-download.intel.com/akdlm/irc_nas/18865/m_BaseKit_p_2022.3.0.8743.dmg
      MACOS_HPCKIT_URL=https://registrationcenter-download.intel.com/akdlm/irc_nas/18866/m_HPCKit_p_2022.3.0.8685.dmg
      ;;
    2022.3.1)
      MACOS_BASEKIT_URL=https://registrationcenter-download.intel.com/akdlm/irc_nas/18971/m_BaseKit_p_2022.3.1.17244.dmg
      MACOS_HPCKIT_URL=https://registrationcenter-download.intel.com/akdlm/irc_nas/18977/m_HPCKit_p_2022.3.1.15344.dmg
      ;;
    2023.0.0)
      MACOS_BASEKIT_URL=https://registrationcenter-download.intel.com/akdlm/irc_nas/19080/m_BaseKit_p_2023.0.0.25441.dmg
      MACOS_HPCKIT_URL=https://registrationcenter-download.intel.com/akdlm/irc_nas/19086/m_HPCKit_p_2023.0.0.25440.dmg
      ;;
    2023.1.0)
      MACOS_BASEKIT_URL=https:/registrationcenter-download.intel.com/akdlm/IRC_NAS/2516a0a0-de4d-4f3d-9e83-545b32127dbb/m_BaseKit_p_2023.1.0.45568.dmg
      MACOS_HPCKIT_URL=https:/registrationcenter-download.intel.com/akdlm/IRC_NAS/a99cb1c5-5af6-4824-9811-ae172d24e594/m_HPCKit_p_2023.1.0.44543.dmg
      ;;
    2023.2.0)
      MACOS_BASEKIT_URL=https://registrationcenter-download.intel.com/akdlm/IRC_NAS/cd013e6c-49c4-488b-8b86-25df6693a9b7/m_BaseKit_p_2023.2.0.49398.dmg
      MACOS_HPCKIT_URL=https://registrationcenter-download.intel.com/akdlm/IRC_NAS/edb4dc2f-266f-47f2-8d56-21bc7764e119/m_HPCKit_p_2023.2.0.49443.dmg
      ;;
    *)
      exit 1
      ;;
  esac

  require_fetch
  $fetch $MACOS_HPCKIT_URL > m_HPCKit.dmg
  hdiutil attach m_HPCKit.dmg
  sudo /Volumes/"$(basename "$MACOS_HPCKIT_URL" .dmg)"/bootstrapper.app/Contents/MacOS/bootstrapper -s \
    --action install \
    --eula=accept \
    --continue-with-optional-error=yes \
    --log-dir=.
  hdiutil detach /Volumes/"$(basename "$MACOS_HPCKIT_URL" .dmg)" -quiet
  rm m_HPCKit.dmg

  source /opt/intel/oneapi/setvars.sh
  export_intel_vars

  export FC="ifort"
  export CC="icc"
  export CXX="icpc"
}

install_intel_win()
{
  local version=$1
  local classic=$2
  intel_version_map_w $version $classic

  case $version in
    2023.2.0)
      WINDOWS_HPCKIT_URL=https://registrationcenter-download.intel.com/akdlm/IRC_NAS/438527fc-7140-422c-a851-389f2791816b/w_HPCKit_p_2023.2.0.49441_offline.exe
      ;;
    2023.1.0)
      WINDOWS_HPCKIT_URL=https://registrationcenter-download.intel.com/akdlm/IRC_NAS/2a13d966-fcc5-4a66-9fcc-50603820e0c9/w_HPCKit_p_2023.1.0.46357_offline.exe
      ;;
    2023.0.0)
      WINDOWS_HPCKIT_URL=https://registrationcenter-download.intel.com/akdlm/irc_nas/19085/w_HPCKit_p_2023.0.0.25931_offline.exe
      ;;
    2022.3.1)
      WINDOWS_HPCKIT_URL=https://registrationcenter-download.intel.com/akdlm/irc_nas/18976/w_HPCKit_p_2022.3.1.19755_offline.exe
      ;;
    2022.3.0)
      WINDOWS_HPCKIT_URL=https://registrationcenter-download.intel.com/akdlm/irc_nas/18857/w_HPCKit_p_2022.3.0.9564_offline.exe
      ;;
    2022.2.0)
      WINDOWS_HPCKIT_URL=https://registrationcenter-download.intel.com/akdlm/IRC_NAS/18680/w_HPCKit_p_2022.2.0.173_offline.exe
      ;;
    # the installer versions below fail
    # 2022.1.2)
    #   WINDOWS_HPCKIT_URL=https://registrationcenter-download.intel.com/akdlm/irc_nas/18529/w_HPCKit_p_2022.1.2.116_offline.exe
    #   ;;
    # 2022.1.0)
    #   WINDOWS_HPCKIT_URL=https://registrationcenter-download.intel.com/akdlm/irc_nas/18417/w_HPCKit_p_2022.1.0.93_offline.exe
    #   ;;
    # 2021.4.0)
    #   WINDOWS_HPCKIT_URL=https://registrationcenter-download.intel.com/akdlm/irc_nas/18247/w_HPCKit_p_2021.4.0.3340_offline.exe
    #   ;;
    # 2021.3.0)
    #   WINDOWS_HPCKIT_URL=https://registrationcenter-download.intel.com/akdlm/irc_nas/17940/w_HPCKit_p_2021.3.0.3227_offline.exe
    #   ;;
    # 2021.2.0)
    #   WINDOWS_HPCKIT_URL=https://registrationcenter-download.intel.com/akdlm/irc_nas/17762/w_HPCKit_p_2021.2.0.2901_offline.exe
    #   ;;
    # 2021.1.0)
    #   WINDOWS_HPCKIT_URL=https://registrationcenter-download.intel.com/akdlm/irc_nas/17392/w_HPCKit_p_2021.1.0.2682_offline.exe
    #   ;;
    *)
      exit 1
      ;;
  esac

  "$GITHUB_ACTION_PATH/install-intel-windows.bat" $WINDOWS_HPCKIT_URL
}

install_intel()
{
  local platform=$1
  local classic=$2
  case $platform in
    linux*)
      install_intel_apt $version $classic
      ;;
    darwin*)
      install_intel_dmg $version
      ;;
    mingw*)
      install_intel_win $version $classic
      ;;
    msys*)
      install_intel_win $version $classic
      ;;
    cygwin*)
      install_intel_win $version $classic
      ;;
    *)
      echo "Unsupported platform: $platform"
      exit 1
      ;;
  esac
}
