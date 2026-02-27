#!/usr/bin/env bash

set -ex

sudo_wrapper() {
  if command -v sudo > /dev/null 2>&1; then
    SUDO="sudo"
  else
    if [[ $EUID -ne 0 ]]; then
      echo "This script requires 'sudo' to install packages. Please install 'sudo' or run as root."
      exit 1
    fi
    SUDO=""
  fi
  $SUDO "$@"
}

# Source the auto-generated latest versions mapping
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/.github/compat/latest-versions.sh"

# Detect the current runner OS
detect_runner_os()
{
  # Try ImageOS environment variable first (GitHub Actions)
  if [ -n "$ImageOS" ]; then
    # Normalize ImageOS to match compatibility matrix naming
    case "$ImageOS" in
      macos15)
        echo "macos-15"
        ;;
      macos14)
        echo "macos-14"
        ;;
      macos15-intel)
        echo "macos-15-intel"
        ;;
      ubuntu24)
        echo "ubuntu-24.04"
        ;;
      ubuntu22)
        echo "ubuntu-22.04"
        ;;
      win22)
        echo "windows-2022"
        ;;
      win25)
        echo "windows-2025"
        ;;
      *)
        # If not recognized, return as-is
        echo "$ImageOS"
        ;;
    esac
    return
  fi

  # Fallback: detect from system
  local platform=$1
  case $platform in
    linux*)
      if [ -f /etc/os-release ]; then
        . /etc/os-release
        if [[ "$ID" == "ubuntu" ]]; then
          echo "ubuntu-$VERSION_ID"
          return
        fi
      fi
      echo "linux"
      ;;
    darwin*)
      local os_ver=$(sw_vers -productVersion | cut -d'.' -f1)
      echo "macos-${os_ver}"
      ;;
    mingw*|msys*|cygwin*)
      # Try to detect Windows version - default to a generic windows
      echo "windows"
      ;;
    *)
      echo "unknown"
      ;;
  esac
}

# Resolve 'latest' to the actual latest supported version for the current runner
resolve_latest_version()
{
  local compiler=$1
  local platform=$2

  local runner_os=$(detect_runner_os "$platform")

  # Sanitize compiler and OS names for variable lookup (replace - and . with _)
  local compiler_safe=$(echo "$compiler" | tr '.-' '__')
  local os_safe=$(echo "$runner_os" | tr '.-' '__')

  # Build variable name
  local var_name="LATEST_${compiler_safe}_${os_safe}"

  # Use indirect variable expansion to get the version
  local version="${!var_name}"

  if [ -z "$version" ]; then
    echo "Error: No latest version defined for $compiler on $runner_os" >&2
    return 1
  fi

  echo "$version"
}

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
  sudo_wrapper apt-get install -y environment-modules
  echo "Environment-modules installed."
  echo "Sourcing modules.sh script to set up environment modules..."
  source /etc/profile.d/modules.sh
  echo "Environment modules set up completed."
}

setup_brew_linux()
{
  eval "$(/home/linuxbrew/.linuxbrew/bin/brew shellenv)"
  echo "/home/linuxbrew/.linuxbrew/bin" >> $GITHUB_PATH
}

install_gcc_brew_linux()
{
  local resolved_version=$1
  setup_brew_linux
  brew install --force gcc@${resolved_version}
  # Add brew binutils to PATH (gcc-15+ requires newer assembler)
  brew install --force binutils
  binutils_dir=$(brew --prefix binutils)/bin
  echo "$binutils_dir" >> $GITHUB_PATH
  bindir=$(brew --prefix)/bin
  sudo_wrapper update-alternatives \
    --install /usr/bin/gcc gcc ${bindir}/gcc-${resolved_version} 100 \
    --slave /usr/bin/gfortran gfortran ${bindir}/gfortran-${resolved_version} \
    --slave /usr/bin/gcov gcov ${bindir}/gcov-${resolved_version} \
    --slave /usr/bin/g++ g++ ${bindir}/g++-${resolved_version}
}

install_gcc_brew()
{
  local resolved_version=$version
  if [[ "$version" == "latest" ]]; then
    resolved_version=$(resolve_latest_version "gcc" "darwin")
  fi

  brew install --force gcc@${resolved_version}
  gcc_version=$resolved_version

  # make an unversioned symlink
  # detect actual homebrew location (differs between Intel and ARM)
  bindir=$(brew --prefix)/bin
  ln -fs ${bindir}/gfortran-${gcc_version} /usr/local/bin/gfortran
  ln -fs ${bindir}/gcc-${gcc_version} /usr/local/bin/gcc
  ln -fs ${bindir}/g++-${gcc_version} /usr/local/bin/g++
}

install_gcc_apt()
{
  local resolved_version=$1

  # Check whether the system gcc version is the version we are after.
  cur=$(apt show gcc 2>/dev/null | grep "Version" | cut -d':' -f3 | cut -d'-' -f1 || echo "")
  maj=$(echo $cur | cut -d'.' -f1)
  needs_install=1
  if [ "$maj" == "$resolved_version" ]; then
    # Check whether that version is installed.
    if apt list --installed gcc-${resolved_version} 2>/dev/null | grep -q "gcc-${resolved_version}/"; then
      echo "GCC $resolved_version already installed"
      needs_install=0
    fi
  fi

  if [ "${needs_install}" == "1" ]; then
    sudo_wrapper apt-get install -y gcc-${resolved_version}-base
    sudo_wrapper apt-get install -y libcc1-0 libgfortran5 libstdc++6
    sudo_wrapper apt-get install -y gcc-${resolved_version} gfortran-${resolved_version} g++-${resolved_version}
  fi

  sudo_wrapper update-alternatives \
    --install /usr/bin/gcc gcc /usr/bin/gcc-${resolved_version} 100 \
    --slave /usr/bin/gfortran gfortran /usr/bin/gfortran-${resolved_version} \
    --slave /usr/bin/gcov gcov /usr/bin/gcov-${resolved_version} \
    --slave /usr/bin/g++ g++ /usr/bin/g++-${resolved_version}
}

install_gcc_choco()
{
  local resolved_version=$version
  if [[ "$version" == "latest" ]]; then
    resolved_version=$(resolve_latest_version "gcc" "mingw")
  fi

  # check if mingw preinstalled via choco, falling back to check directly for gfortran
  cur=$(choco list -e mingw -r | cut -d'|' -f2)
  if [[ "$cur" == "" ]] && [[ "$(which gfortran)" != "" ]]; then
    cur=$(gfortran --version | grep -woE '[0123456789.]+' | head -n 1)
  fi
  maj=$(echo $cur | cut -d'.' -f1)
  # if already installed, nothing to do
  if [ "$maj" == "$resolved_version" ]; then
    echo "GCC $resolved_version already installed"
  else
    # otherwise hide preinstalled mingw compilers
    mv /c/mingw64 "$RUNNER_TEMP/"
    # ...and install selected version
    case $resolved_version in
      15)
        choco install mingw --version 15.2.0 --force
        # mingw 13+ on Windows doesn't create shims (http://disq.us/p/2w5c5tj)
        # so hide Strawberry compilers and manually add mingw bin dir to PATH
        mkdir "$RUNNER_TEMP/strawberry"
        mv /c/Strawberry/c/bin/gfortran "$RUNNER_TEMP/strawberry/gfortran"
        mv /c/Strawberry/c/bin/gcc "$RUNNER_TEMP/strawberry/gcc"
        mv /c/Strawberry/c/bin/g++ "$RUNNER_TEMP/strawberry/g++"
        echo "C:\ProgramData\mingw64\mingw64\bin" >> $GITHUB_PATH
        ;;
      14)
        choco install mingw --version 14.2.0 --force
        # mingw 13+ on Windows doesn't create shims (http://disq.us/p/2w5c5tj)
        # so hide Strawberry compilers and manually add mingw bin dir to PATH
        mkdir "$RUNNER_TEMP/strawberry"
        mv /c/Strawberry/c/bin/gfortran "$RUNNER_TEMP/strawberry/gfortran"
        mv /c/Strawberry/c/bin/gcc "$RUNNER_TEMP/strawberry/gcc"
        mv /c/Strawberry/c/bin/g++ "$RUNNER_TEMP/strawberry/g++"
        echo "C:\ProgramData\mingw64\mingw64\bin" >> $GITHUB_PATH
        ;;
      13)
        choco install mingw --version 13.2.0 --force
        # mingw 13+ on Windows doesn't create shims (http://disq.us/p/2w5c5tj)
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
        echo "Unsupported version: $version (choose 8-15, or latest)"
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
}

install_gcc()
{
  local platform=$1
  case $platform in
    linux*)
      local resolved_version=$version
      if [ "$version" == "latest" ]; then
        resolved_version=$(resolve_latest_version "gcc" "linux")
      fi
      # Add PPA for additional GCC versions, then probe apt availability.
      # GCC versions not in apt (e.g. gcc-15 on ubuntu-22.04/24.04) fall back to brew.
      sudo_wrapper add-apt-repository --yes ppa:ubuntu-toolchain-r/test
      sudo_wrapper apt-get update -q
      if apt-cache show gcc-${resolved_version} &>/dev/null; then
        install_gcc_apt "$resolved_version"
      else
        install_gcc_brew_linux "$resolved_version"
      fi
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

  export FC="gfortran"
  export CC="gcc"
  export CXX="g++"
}

detect_aocc_root()
{
  if [ -n "$AOCC_ROOT" ] && [ -d "$AOCC_ROOT" ]; then
    echo "$AOCC_ROOT"
    return
  fi

  if [ -d /opt/AMD ]; then
    local candidate
    candidate=$(ls -d /opt/AMD/aocc-compiler-* 2>/dev/null | sort -V | tail -n 1 || true)
    if [ -n "$candidate" ] && [ -d "$candidate" ]; then
      echo "$candidate"
      return
    fi
  fi

  echo ""
}

install_aocc_linux()
{
  local root
  root=$(detect_aocc_root)

  # Resolve requested AOCC version
  local resolved_version=$version
  if [ "$resolved_version" = "latest" ]; then
    resolved_version=$(resolve_latest_version "aocc" "linux")
  fi

  local aocc_deb
  local aocc_url
  local aocc_sha256

  case "$resolved_version" in
    5.1.0)
      aocc_deb="aocc-compiler-5.1.0_1_amd64.deb"
      aocc_url="https://download.amd.com/developer/eula/aocc/aocc-5-1/${aocc_deb}"
      aocc_sha256="42f9ed0713a8fe269d5a5b40b1992a5380ff59b4441e58d38eb9f27df5bfe6df"
      ;;
    *)
      echo "Unsupported AOCC version: $resolved_version"
      exit 1
      ;;
  esac

  if [ -z "$root" ]; then
    require_fetch

    local tmp_dir
    tmp_dir="$(mktemp -d)"
    cd "$tmp_dir" || exit 42

    echo "Downloading AOCC ${resolved_version} from AMD..."
    $fetch "$aocc_url" > "$aocc_deb"

    echo "${aocc_sha256}  ${aocc_deb}" | sha256sum -c -

    # Install the AOCC .deb
    sudo_wrapper apt-get install -y "./${aocc_deb}"

    cd - >/dev/null 2>&1 || true
    rm -rf "$tmp_dir"

    root=$(detect_aocc_root)
    if [ -z "$root" ]; then
      echo "AOCC installation completed but installation directory could not be detected." >&2
      exit 1
    fi
  fi

  # AOCC provides setenv_AOCC.sh to configure the environment
  source "$root/setenv_AOCC.sh"

  # Ensure standard compiler environment variables are set
  export FC="flang"
  export CC="clang"
  export CXX="clang++"

  # Export AOCC-related environment to subsequent steps
  if [ -n "$GITHUB_ENV" ]; then
    env | grep -i 'aocc\|AMD' >> "$GITHUB_ENV" || true
  fi

  echo "The AOCC flang installed is:"
  flang --version
}

install_aocc()
{
  local platform=$1
  case $platform in
    linux*)
      install_aocc_linux
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
      2021.12.0 | 2021.12)
        version=2024.1
        ;;
      2021.11.0 | 2021.11)
        version=2024.0
        ;;
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
      2024.1 | 2024.1.0)
        version=2024.1
        ;;
      2024.0 | 2024.0.0)
        version=2024.0
        ;;
      2025.0 | 2025.0.1)
        version=2025.0
        ;;
      2025.2 | 2025.2.1)
        version=2025.2
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
      2021.12.0 | 2021.12)
        version=2024.1.0
        ;;
      2021.11.0 | 2021.11)
        version=2024.0.1
        ;;
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
      2025.2 | 2025.2.1)
        version=2025.2.1
        ;;
      2025.0 | 2025.0.1)
        version=2025.0.1
        ;;
      2024.1 | 2024.1.0)
        version=2024.1.0
        ;;
      2024.0 | 2024.0.0)
        version=2024.0.1
        ;;
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
  if [ "$version" != "latest" ]; then
    intel_version_map_l $version $classic
  fi

  require_fetch
  local _KEY="GPG-PUB-KEY-INTEL-SW-PRODUCTS.PUB"
  $fetch https://apt.repos.intel.com/intel-gpg-keys/$_KEY > $_KEY
  sudo_wrapper apt-key add $_KEY
  rm $_KEY
  echo "deb https://apt.repos.intel.com/oneapi all main" \
    | sudo_wrapper tee /etc/apt/sources.list.d/oneAPI.list
  sudo_wrapper apt-get update

  if [ "$version" == "latest" ]; then
    sudo_wrapper apt-get install -y \
      intel-oneapi-compiler-fortran \
      intel-oneapi-compiler-dpcpp-cpp
  else
    # c/cpp compiler package names changed with 2024+
    case $version in
      2024* | 2025*)
        sudo_wrapper apt-get install -y \
          intel-oneapi-compiler-{fortran,dpcpp-cpp}-$version
        ;;
      *)
        sudo_wrapper apt-get install -y \
          intel-oneapi-compiler-{fortran,dpcpp-cpp-and-cpp-classic}-$version
        ;;
    esac
  fi

  source /opt/intel/oneapi/setvars.sh
  export_intel_vars
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
      MACOS_BASEKIT_URL=https://registrationcenter-download.intel.com/akdlm/IRC_NAS/2516a0a0-de4d-4f3d-9e83-545b32127dbb/m_BaseKit_p_2023.1.0.45568.dmg
      MACOS_HPCKIT_URL=https://registrationcenter-download.intel.com/akdlm/IRC_NAS/a99cb1c5-5af6-4824-9811-ae172d24e594/m_HPCKit_p_2023.1.0.44543.dmg
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
  sudo_wrapper /Volumes/"$(basename "$MACOS_HPCKIT_URL" .dmg)"/bootstrapper.app/Contents/MacOS/bootstrapper -s \
    --action install \
    --eula=accept \
    --continue-with-optional-error=yes \
    --log-dir=.
  hdiutil detach /Volumes/"$(basename "$MACOS_HPCKIT_URL" .dmg)" -quiet
  rm m_HPCKit.dmg

  source /opt/intel/oneapi/setvars.sh
  export_intel_vars
}

install_intel_win()
{
  local version=$1
  local classic=$2
  intel_version_map_w $version $classic

  case $version in
    2025.2.1)
      WINDOWS_HPCKIT_URL=https://registrationcenter-download.intel.com/akdlm/IRC_NAS/e63ac2b4-8a9a-4768-979a-399a8b6299de/intel-oneapi-hpc-toolkit-2025.2.1.46_offline.exe
      WINDOWS_HPCKIT_COMPONENTS=intel.oneapi.win.ifort-compiler:intel.oneapi.win.cpp-dpcpp-common
      ;;
    2025.0.1)
      WINDOWS_HPCKIT_URL=https://registrationcenter-download.intel.com/akdlm/IRC_NAS/a37c30c3-a846-4371-a85d-603e9a9eb94c/intel-oneapi-hpc-toolkit-2025.0.1.48_offline.exe
      WINDOWS_HPCKIT_COMPONENTS=intel.oneapi.win.ifort-compiler:intel.oneapi.win.cpp-dpcpp-common
      ;;
    2024.1.0)
      WINDOWS_HPCKIT_URL=https://registrationcenter-download.intel.com/akdlm/IRC_NAS/c95a3b26-fc45-496c-833b-df08b10297b9/w_HPCKit_p_2024.1.0.561_offline.exe
      WINDOWS_HPCKIT_COMPONENTS=intel.oneapi.win.ifort-compiler:intel.oneapi.win.cpp-dpcpp-common
      ;;
    2024.0.1)
      WINDOWS_HPCKIT_URL=https://registrationcenter-download.intel.com/akdlm/IRC_NAS/7a6db8a1-a8b9-4043-8e8e-ca54b56c34e4/w_HPCKit_p_2024.0.1.35_offline.exe
      WINDOWS_HPCKIT_COMPONENTS=intel.oneapi.win.ifort-compiler:intel.oneapi.win.cpp-dpcpp-common
      ;;
    2023.2.0)
      WINDOWS_HPCKIT_URL=https://registrationcenter-download.intel.com/akdlm/IRC_NAS/438527fc-7140-422c-a851-389f2791816b/w_HPCKit_p_2023.2.0.49441_offline.exe
      WINDOWS_HPCKIT_COMPONENTS=intel.oneapi.win.ifort-compiler:intel.oneapi.win.cpp-compiler
      ;;
    2023.1.0)
      WINDOWS_HPCKIT_URL=https://registrationcenter-download.intel.com/akdlm/IRC_NAS/2a13d966-fcc5-4a66-9fcc-50603820e0c9/w_HPCKit_p_2023.1.0.46357_offline.exe
      WINDOWS_HPCKIT_COMPONENTS=intel.oneapi.win.ifort-compiler:intel.oneapi.win.cpp-compiler
      ;;
    2023.0.0)
      WINDOWS_HPCKIT_URL=https://registrationcenter-download.intel.com/akdlm/irc_nas/19085/w_HPCKit_p_2023.0.0.25931_offline.exe
      WINDOWS_HPCKIT_COMPONENTS=intel.oneapi.win.ifort-compiler:intel.oneapi.win.cpp-compiler
      ;;
    2022.3.1)
      WINDOWS_HPCKIT_URL=https://registrationcenter-download.intel.com/akdlm/irc_nas/18976/w_HPCKit_p_2022.3.1.19755_offline.exe
      WINDOWS_HPCKIT_COMPONENTS=intel.oneapi.win.ifort-compiler:intel.oneapi.win.cpp-compiler
      ;;
    2022.3.0)
      WINDOWS_HPCKIT_URL=https://registrationcenter-download.intel.com/akdlm/irc_nas/18857/w_HPCKit_p_2022.3.0.9564_offline.exe
      WINDOWS_HPCKIT_COMPONENTS=intel.oneapi.win.ifort-compiler:intel.oneapi.win.cpp-compiler
      ;;
    2022.2.0)
      WINDOWS_HPCKIT_URL=https://registrationcenter-download.intel.com/akdlm/IRC_NAS/18680/w_HPCKit_p_2022.2.0.173_offline.exe
      WINDOWS_HPCKIT_COMPONENTS=intel.oneapi.win.ifort-compiler:intel.oneapi.win.cpp-compiler
      ;;
    *)
      exit 1
      ;;
  esac

  "$GITHUB_ACTION_PATH/install-intel-windows.bat" $WINDOWS_HPCKIT_URL $WINDOWS_HPCKIT_COMPONENTS

  # don't call export_intel_vars here because the install may have
  # been restored from cache. export variables in action.yml after
  # installation or cache restore.
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

  # install NVIDIA HPC SDK
  echo "Installing NVIDIA HPC SDK $version..."
  curl https://developer.download.nvidia.com/hpc-sdk/ubuntu/DEB-GPG-KEY-NVIDIA-HPC-SDK | sudo_wrapper gpg --dearmor -o /usr/share/keyrings/nvidia-hpcsdk-archive-keyring.gpg
  echo 'deb [signed-by=/usr/share/keyrings/nvidia-hpcsdk-archive-keyring.gpg] https://developer.download.nvidia.com/hpc-sdk/ubuntu/amd64 /' | sudo_wrapper tee /etc/apt/sources.list.d/nvhpc.list
  sudo_wrapper apt-get update -y
  if [ "$version" == "latest" ]; then
    sudo_wrapper apt-get install -y nvhpc
    version=$(ls /opt/nvidia/hpc_sdk/Linux_$(uname -m)/ | grep -E '^[0-9]+\.[0-9]+$' | sort -V | tail -1)
  else
    # to convert version format from X.Y to X-Y
    local cversion=$(echo "$version" | tr '.' '-')
    sudo_wrapper apt-get install -y nvhpc-$cversion
  fi
  echo "NVIDIA HPC SDK $version installed."

  # load NVIDIA HPC SDK module
  echo "Loading NVIDIA HPC SDK $version module..."
  NVCOMPILERS=/opt/nvidia/hpc_sdk; export NVCOMPILERS
  export MODULEPATH=$NVCOMPILERS/modulefiles:$MODULEPATH
  module load nvhpc
  echo "NVIDIA HPC SDK $version module loaded."

  # set environment variables
  export_nvidiahpc_vars $version
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

  export FC="nvfortran"
  export CC="nvc"
  export CXX="nvc++"
}

install_lfortran_l()
{
  local version=$1
  export CC="gcc"
  export CXX="g++"
  export CONDA=conda
  $CONDA install -c conda-forge -n base -y lfortran=$version
}

install_lfortran_w()
{
  local version=$1
  export CC="cl"
  export CXX="cl"
  export CONDA=$CONDA\\Scripts\\conda  # https://github.com/actions/runner-images/blob/main/images/windows/Windows2022-Readme.md#environment-variables
  $CONDA install -c conda-forge -n base -y lfortran=$version
}

install_lfortran_m()
{
  local version=$1
  export CC="gcc"
  export CXX="g++"
  export CONDA_ROOT_PREFIX=$MAMBA_ROOT_PREFIX
  export CONDA=micromamba
  $CONDA install -c conda-forge -n base -y lfortran=$version
}

install_lfortran()
{
  local platform=$1
  local resolved_version=$version

  if [ "$version" == "latest" ]; then
    resolved_version=$(resolve_latest_version "lfortran" "$platform")
  fi

  case $platform in
    linux*)
      install_lfortran_l $resolved_version
      ;;
    darwin*)
      install_lfortran_m $resolved_version
      ;;
    mingw*)
      install_lfortran_w $resolved_version
      ;;
    msys*)
      install_lfortran_w $resolved_version
      ;;
    cygwin*)
      install_lfortran_w $resolved_version
      ;;
    *)
      echo "Unsupported platform: $platform"
      exit 1
      ;;
  esac

  echo $($CONDA run -n base which lfortran | sed 's/lfortran//') >> $GITHUB_PATH
  export FC="lfortran"
}
