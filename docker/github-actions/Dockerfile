FROM ubuntu:24.04

ARG COMPILER
ARG VERSION

# Update dependencies.
RUN apt update && apt -y upgrade

# Create a directory for the GITHUB_* files
RUN mkdir -p /etc/github-actions

# Copy in the script for use when running this container, to populate the runtime environment.
COPY --chmod=755 ./update-job-environment.sh /etc/github-actions/update-job-environment.sh

# Install the specified Fortran compiler.
COPY --follow-symlinks ./main.sh /tmp/main.sh
COPY --follow-symlinks ./setup-fortran.sh /tmp/setup-fortran.sh
COPY --chmod=755 ./run-setup-fortran.sh /tmp/run-setup-fortran.sh
RUN env GITHUB_ENV=/etc/github-actions/ENV GITHUB_PATH=/etc/github-actions/PATH /tmp/run-setup-fortran.sh
