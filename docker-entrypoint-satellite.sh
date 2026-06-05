#!/bin/sh
# Docker entrypoint for the Checkstack Satellite.
#
# Supports a `print-seccomp` subcommand that writes the bundled tuned seccomp
# profile to stdout. An operator places it on the satellite HOST before
# `docker run`, because the Docker daemon reads `--security-opt seccomp=<file>`
# at container-create time and a container cannot relax its own seccomp from the
# inside. The profile travels WITH this image, so it works fully offline /
# air-gapped (no GitHub, no core round-trip):
#
#   docker run --rm ghcr.io/enyineer/checkstack-satellite:latest print-seccomp > checkstack-userns.json
#
# Then start the satellite with:
#   --security-opt seccomp=checkstack-userns.json --security-opt systempaths=unconfined
SECCOMP_PROFILE=/app/deploy/seccomp/checkstack-userns.json

if [ "$1" = "print-seccomp" ]; then
  cat "$SECCOMP_PROFILE"
  exit 0
fi

exec "$@"
