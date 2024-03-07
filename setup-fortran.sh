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

# Function to install environment-modules via apt
# https://github.com/cea-hpc/modules
install_environment_modules_apt() {
  echo "Installing environment-modules package..."
  sudo apt-get install -y environment-modules
  echo "Environment-modules installed."
  echo "Sourcing modules.sh script to set up environment modules..."
  source /etc/profile.d/modules.sh
  echo "Environment modules set up completed."
}

install_gcc_brew()
{
  # check if gcc preinstalled via brew
  cur=$(brew list --versions gcc | cut -d' ' -f2)
  maj=$(echo $cur | cut -d'.' -f1)
  # if already installed, nothing to do
  if [ "$maj" == "$version" ]; then
    echo "GCC $version already installed"
  else
    # otherwise install selected version
    brew install gcc@${version}
  fi

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
  # check if gcc preinstalled via apt
  cur=$(apt show gcc | grep "Version" | cut -d':' -f3 | cut -d'-' -f1)
  maj=$(echo $cur | cut -d'.' -f1)
  if [ "$maj" == "$version" ]; then
    echo "GCC $version already installed"
  else
    sudo add-apt-repository --yes ppa:ubuntu-toolchain-r/test
    sudo apt-get update
    sudo apt-get install -y gcc-${version} gfortran-${version} g++-${version}
  fi

  sudo update-alternatives \
    --install /usr/bin/gcc gcc /usr/bin/gcc-${version} 100 \
    --slave /usr/bin/gfortran gfortran /usr/bin/gfortran-${version} \
    --slave /usr/bin/gcov gcov /usr/bin/gcov-${version} \
    --slave /usr/bin/g++ g++ /usr/bin/g++-${version}

  export FC="gfortran"
  export CC="gcc"
  export CXX="g++"
}

install_gcc_choco()
{
  # check if mingw preinstalled via choco, falling back to check directly for gfortran
  cur=$(choco list -e mingw -r | cut -d'|' -f2)
  if [[ "$cur" == "" ]] && [[ "$(which gfortran)" != "" ]]; then
    cur=$(gfortran --version | grep -woE '[0123456789.]+' | head -n 1)
  fi
  maj=$(echo $cur | cut -d'.' -f1)
  # if already installed, nothing to do
  if [ "$maj" == "$version" ]; then
    echo "GCC $version already installed"
  else
    # otherwise hide preinstalled mingw compilers
    mv /c/mingw64 "$RUNNER_TEMP/"
    # ...and install selected version
    case $version in
      13)
        choco install mingw --version 13.2.0 --force
        # mingw 13 on Windows doesn't create shims (http://disq.us/p/2w5c5tj)
        # so hide Strawberry compilers and manually add mingw bin dir to PATH
        mkdir "$RUNNER_TEMP/strawberry"
        mv /c/Strawberry/c/bin/gfortran "$RUNNER_TEMP/strawberry/gfortran"
        mv /c/Strawberry/c/bin/gcc "$RUNNER_TEMP/strawberry/gcc"
        mv /c/Strawberry/c/bin/g++ "$RUNNER_TEMP/strawberry/g++"
        echo "C:\ProgramData\mingw64\mingw64\bin" >> $GITHUB_PATH
        ;;
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
        echo "Unsupported version: $version (choose 8-13)"
        exit 1
        ;;
    esac
  fi

  # missing DLL workaround
  FCDIR=/c/ProgramData/Chocolatey/bin
  LNDIR=/c/ProgramData/Chocolatey/lib/mingw/tools/install/mingw64/bin
  if [ -d "$FCDIR" ] && [ -f "$LNDIR/libgfortran-5.dll" ] && [ ! -f "$FCDIR/libgfortran-5.dll" ]; then
      ln -s "$LNDIR/libgfortran-5.dll" "$FCDIR/libgfortran-5.dll"
  fi

  export FC="gfortran"
  export CC="gcc"
  export CXX="g++"
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
MKLLIB=$MKLLIB
DYLD_LIBRARY_PATH=$DYLD_LIBRARY_PATH
ONEAPI_ROOT=$ONEAPI_ROOT
CLASSPATH=$CLASSPATH
CMAKE_PREFIX_PATH=$CMAKE_PREFIX_PATH
OCL_ICD_FILENAMES=$OCL_ICD_FILENAMES
INTEL_PYTHONHOME=$INTEL_PYTHONHOME
CPATH=$CPATH
SETVARS_COMPLETED=$SETVARS_COMPLETED
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
      2023.2 | 2023.1 | 2023.0 | 2022.2 | 2022.1 | 2021.4 | 2021.2)
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

mkl_version_map_l()
{
  local intel_version=$1
  case $intel_version in
    2021.1 | 2021.1.2)
      mkl_version=2021.1.1
      ;;
    *)
      mkl_version=$intel_version
      ;;
  esac
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

mkl_version_map_m()
{
  local intel_version=$1
  case $intel_version in
    2021.1.0 | 2021.2.0 | 2021.3.0 | 2021.4.0 | 2022.2.0 | 2022.3.0 | 2022.3.1 | 2023.0.0 )
      mkl_version=2022.2.0
      ;;
    2022.1.0)
      mkl_version=""
      ;;
    2023.1.0)
      mkl_version=2023.1.0
      ;;
    *)
      mkl_version=2023.2.0
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
  local mkl_version=$1
  local install_mkl=$3
  intel_version_map_l $version $classic
  mkl_version_map_l $version

  require_fetch
  local _KEY="GPG-PUB-KEY-INTEL-SW-PRODUCTS-2023.PUB"
  $fetch https://apt.repos.intel.com/intel-gpg-keys/$_KEY > $_KEY
  sudo apt-key add $_KEY
  rm $_KEY
  echo "deb https://apt.repos.intel.com/oneapi all main" \
    | sudo tee /etc/apt/sources.list.d/oneAPI.list
  sudo apt-get update

  if $install_mkl; then
    sudo apt-get install \
      intel-oneapi-compiler-{fortran,dpcpp-cpp-and-cpp-classic}-$version \
      intel-oneapi-mkl-$mkl_version
  else
    sudo apt-get install \
      intel-oneapi-compiler-{fortran,dpcpp-cpp-and-cpp-classic}-$version
  fi

  source /opt/intel/oneapi/setvars.sh

  if $classic; then
    export FC="ifort"
    export CC="icc"
    export CXX="icpc"
  else
    export FC="ifx"
    export CC="icx"
    export CXX="icpx"
  fi
  if $install_mkl; then
    export MKLLIB="$ONEAPI_ROOT/mkl/latest/lib/intel64"
  fi
  export_intel_vars
}

install_intel_dmg()
{
  local version=$1
  local mkl_version=$1
  local install_mkl=$2
  intel_version_map_m $version
  mkl_version_map_m $version

  case $version in
    2021.1.0)
      MACOS_HPCKIT_URL=https://registrationcenter-download.intel.com/akdlm/irc_nas/17398/m_HPCKit_p_2021.1.0.2681.dmg
      ;;
    2021.2.0)
      MACOS_HPCKIT_URL=https://registrationcenter-download.intel.com/akdlm/irc_nas/17643/m_HPCKit_p_2021.2.0.2903.dmg
      ;;
    2021.3.0)
      MACOS_HPCKIT_URL=https://registrationcenter-download.intel.com/akdlm/irc_nas/17890/m_HPCKit_p_2021.3.0.3226.dmg
      ;;
    2021.4.0)
      MACOS_HPCKIT_URL=https://registrationcenter-download.intel.com/akdlm/irc_nas/18242/m_HPCKit_p_2021.4.0.3389.dmg
      ;;
    2022.1.0)
      MACOS_HPCKIT_URL=https://registrationcenter-download.intel.com/akdlm/irc_nas/18341/m_HPCKit_p_2022.1.0.86.dmg
      ;;
    2022.2.0)
      MACOS_HPCKIT_URL=https://registrationcenter-download.intel.com/akdlm/IRC_NAS/18681/m_HPCKit_p_2022.2.0.158_offline.dmg
      ;;
    2022.3.0)
      MACOS_HPCKIT_URL=https://registrationcenter-download.intel.com/akdlm/irc_nas/18866/m_HPCKit_p_2022.3.0.8685.dmg
      ;;
    2022.3.1)
      MACOS_HPCKIT_URL=https://registrationcenter-download.intel.com/akdlm/irc_nas/18977/m_HPCKit_p_2022.3.1.15344.dmg
      ;;
    2023.0.0)
      MACOS_HPCKIT_URL=https://registrationcenter-download.intel.com/akdlm/irc_nas/19086/m_HPCKit_p_2023.0.0.25440.dmg
      ;;
    2023.1.0)
      MACOS_HPCKIT_URL=https:/registrationcenter-download.intel.com/akdlm/IRC_NAS/a99cb1c5-5af6-4824-9811-ae172d24e594/m_HPCKit_p_2023.1.0.44543.dmg
      ;;
    2023.2.0)
      MACOS_HPCKIT_URL=https://registrationcenter-download.intel.com/akdlm/IRC_NAS/edb4dc2f-266f-47f2-8d56-21bc7764e119/m_HPCKit_p_2023.2.0.49443.dmg
      ;;
    *)
      exit 1
      ;;
  esac

  case $mkl_version in
    2022.2.0)
      MACOS_BASEKIT_URL=https://registrationcenter-download.intel.com/akdlm/IRC_NAS/18675/m_BaseKit_p_2022.2.0.226_offline.dmg
      ;;
    2023.1.0)
      MACOS_BASEKIT_URL=https:/registrationcenter-download.intel.com/akdlm/IRC_NAS/2516a0a0-de4d-4f3d-9e83-545b32127dbb/m_BaseKit_p_2023.1.0.45568.dmg
      ;;
    2023.2.0)
      MACOS_BASEKIT_URL=https://registrationcenter-download.intel.com/akdlm/IRC_NAS/cd013e6c-49c4-488b-8b86-25df6693a9b7/m_BaseKit_p_2023.2.0.49398.dmg
      ;;
    "")
      ;;
    *)
      exit 1
      ;;
  esac

  if $install_mkl; then
    if [ "$MACOS_BASEKIT_URL" == "" ]; then
      echo "ERROR: MACOS_BASEKIT_URL is empty - please check the version mapping for MKL"
      echo "SKIPPING MKL installation..."
    else
      require_fetch
      $fetch $MACOS_BASEKIT_URL > m_BASEKit.dmg
      ls -lh
      hdiutil verify m_BASEKit.dmg
      hdiutil attach m_BASEKit.dmg
      sudo /Volumes/"$(basename "$MACOS_BASEKIT_URL" .dmg)"/bootstrapper.app/Contents/MacOS/bootstrapper -s \
        --action install \
        --eula=accept \
        --continue-with-optional-error=yes \
        --log-dir=.
      hdiutil detach /Volumes/"$(basename "$MACOS_BASEKIT_URL" .dmg)" -quiet
      rm m_BASEKit.dmg
    fi
  fi

  require_fetch
  $fetch $MACOS_HPCKIT_URL > m_HPCKit.dmg
  hdiutil verify m_HPCKit.dmg
  hdiutil attach m_HPCKit.dmg
  sudo /Volumes/"$(basename "$MACOS_HPCKIT_URL" .dmg)"/bootstrapper.app/Contents/MacOS/bootstrapper -s \
    --action install \
    --eula=accept \
    --continue-with-optional-error=yes \
    --log-dir=.
  hdiutil detach /Volumes/"$(basename "$MACOS_HPCKIT_URL" .dmg)" -quiet
  rm m_HPCKit.dmg

  source /opt/intel/oneapi/setvars.sh

  export FC="ifort"
  export CC="icc"
  export CXX="icpc"

  if $install_mkl; then
    export MKLLIB="$ONEAPI_ROOT/mkl/latest/lib"
    export DYLD_LIBRARY_PATH="$MKLLIB":$DYLD_LIBRARY_PATH
  fi

  export_intel_vars
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

  # don't call export_intel_vars here because the install may have
  # been restored from cache. export variables in action.yml after
  # installation or cache restore.
}

install_intel()
{
  local platform=$1
  local classic=$2
  local install_mkl=$3
  case $platform in
    linux*)
      install_intel_apt $version $classic $install_mkl
      ;;
    darwin*)
      install_intel_dmg $version $install_mkl
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

export_nvidiahpc_vars()
{
    local version=$1

    # to convert version format from X.Y to X-Y
    local cversion=$(echo "$version" | tr '.' '-')

  cat >> $GITHUB_ENV <<EOF
NVARCH=`uname -s`_`uname -m`;
NVCOMPILERS=/opt/nvidia/hpc_sdk;
MANPATH=$MANPATH:$NVCOMPILERS/$NVARCH/$cversion/compilers/man;
PATH=$NVCOMPILERS/$NVARCH/$cversion/compilers/bin:$PATH;
PATH=$NVCOMPILERS/$NVARCH/$cversion/comm_libs/mpi/bin:$PATH
MANPATH=$MANPATH:$NVCOMPILERS/$NVARCH/$cversion/comm_libs/mpi/man
EOF
  for path in ${PATH//:/ }; do
    echo $path >> $GITHUB_PATH
  done
}

install_nvidiahpc_apt()
{
  local version=$1

  # install environment-modules
  install_environment_modules_apt

  # to convert version format from X.Y to X-Y
  local cversion=$(echo "$version" | tr '.' '-')

  # install NVIDIA HPC SDK
  echo "Installing NVIDIA HPC SDK $version..."
  curl https://developer.download.nvidia.com/hpc-sdk/ubuntu/DEB-GPG-KEY-NVIDIA-HPC-SDK | sudo gpg --dearmor -o /usr/share/keyrings/nvidia-hpcsdk-archive-keyring.gpg
  echo 'deb [signed-by=/usr/share/keyrings/nvidia-hpcsdk-archive-keyring.gpg] https://developer.download.nvidia.com/hpc-sdk/ubuntu/amd64 /' | sudo tee /etc/apt/sources.list.d/nvhpc.list
  sudo apt-get update -y
  sudo apt-get install -y nvhpc-$cversion
  echo "NVIDIA HPC SDK $version installed."

  # load NVIDIA HPC SDK module
  echo "Loading NVIDIA HPC SDK $version module..."
  NVCOMPILERS=/opt/nvidia/hpc_sdk; export NVCOMPILERS
  export MODULEPATH=$NVCOMPILERS/modulefiles:$MODULEPATH
  module load nvhpc
  echo "NVIDIA HPC SDK $version module loaded."

  # set environment variables
  echo "Setting environment variables..."
  export_nvidiahpc_vars $version

  # set environment variables
  export FC="nvfortran"
  export CC="nvc"
  export CXX="nvc++"
  echo "Environment variables set."
}

install_nvidiahpc()
{
  local platform=$1
  case $platform in
    linux*)
      install_nvidiahpc_apt $version
      ;;
    darwin*)
      echo "NVIDIA HPC SDK is not supported on macOS."
      exit 1
      ;;
    mingw*)
      echo "NVIDIA HPC SDK is not supported on Windows."
      exit 1
      ;;
    msys*)
      echo "NVIDIA HPC SDK is not supported on MSYS."
      exit 1
      ;;
    cygwin*)
      echo "NVIDIA HPC SDK is not supported on Cygwin."
      exit 1
      ;;
    *)
      echo "Unsupported platform: $platform"
      exit 1
      ;;
  esac
}