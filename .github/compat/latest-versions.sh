#!/usr/bin/env bash
# Auto-generated from .github/compat/matrix.yml
# DO NOT EDIT MANUALLY - Run .github/compat/generate_latest_versions.py to regenerate

# Latest supported gcc versions by runner
declare -A LATEST_GCC_VERSION
LATEST_GCC_VERSION["macos-14"]="15"
LATEST_GCC_VERSION["macos-15"]="15"
LATEST_GCC_VERSION["macos-15-intel"]="15"
LATEST_GCC_VERSION["ubuntu-22.04"]="14"
LATEST_GCC_VERSION["ubuntu-24.04"]="14"
LATEST_GCC_VERSION["windows-2022"]="15"
LATEST_GCC_VERSION["windows-2025"]="15"

# Latest supported intel versions by runner
declare -A LATEST_INTEL_VERSION
LATEST_INTEL_VERSION["macos-15-intel"]="2025.2"
LATEST_INTEL_VERSION["ubuntu-22.04"]="2025.2"
LATEST_INTEL_VERSION["ubuntu-24.04"]="2025.2"
LATEST_INTEL_VERSION["windows-2022"]="2025.2"
LATEST_INTEL_VERSION["windows-2025"]="2025.2"

# Latest supported intel-classic versions by runner
declare -A LATEST_INTEL_CLASSIC_VERSION
LATEST_INTEL_CLASSIC_VERSION["macos-14"]="2021.12"
LATEST_INTEL_CLASSIC_VERSION["macos-15"]="2021.12"
LATEST_INTEL_CLASSIC_VERSION["macos-15-intel"]="2021.12"
LATEST_INTEL_CLASSIC_VERSION["ubuntu-22.04"]="2021.12"
LATEST_INTEL_CLASSIC_VERSION["ubuntu-24.04"]="2021.12"
LATEST_INTEL_CLASSIC_VERSION["windows-2022"]="2021.12"
LATEST_INTEL_CLASSIC_VERSION["windows-2025"]="2021.12"

# Latest supported lfortran versions by runner
declare -A LATEST_LFORTRAN_VERSION
LATEST_LFORTRAN_VERSION["macos-14"]="0.58.0"
LATEST_LFORTRAN_VERSION["macos-15"]="0.58.0"
LATEST_LFORTRAN_VERSION["macos-15-intel"]="0.58.0"
LATEST_LFORTRAN_VERSION["ubuntu-22.04"]="0.58.0"
LATEST_LFORTRAN_VERSION["ubuntu-24.04"]="0.58.0"
LATEST_LFORTRAN_VERSION["windows-2022"]="0.58.0"
LATEST_LFORTRAN_VERSION["windows-2025"]="0.58.0"

# Latest supported nvidia-hpc versions by runner
declare -A LATEST_NVIDIA_HPC_VERSION
LATEST_NVIDIA_HPC_VERSION["ubuntu-22.04"]="25.1"
LATEST_NVIDIA_HPC_VERSION["ubuntu-24.04"]="25.1"
