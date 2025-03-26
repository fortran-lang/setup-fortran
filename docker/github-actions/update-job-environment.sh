#!/bin/bash
# This script is to be run within a GitHub Action job step, and is used to update the runtime
# environment variables based on environment variables setup during build time.
set -uex

D=/etc/github-actions

for v in ENV PATH; do
  if [ -r ${D}/${v} ]; then
    env_var=GITHUB_${v}
    if env | grep -q "^${env_var}="; then
      cat ${D}/${v} >> ${!env_var}
    fi
  fi
done
