#!/bin/bash
set -e

# Install necessary dependencies.
apt install -y make software-properties-common sudo

# Run setup-fortran.
cd /tmp
source main.sh
cd -

# Add the value of exported compiler environment variables to the set of environment variables to persist.
for v in FC CC CXX; do
  if [ ! -z "${!v}" ]; then
    echo "${v}=${!v}" >> ${GITHUB_ENV}
  fi
done
