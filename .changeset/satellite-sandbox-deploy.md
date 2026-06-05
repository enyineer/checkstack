---
"@checkstack/satellite-frontend": patch
---

Satellite deployments now ship with the script-sandbox flags they need, so script-based health checks run on satellites out of the box.

A satellite executes the same script checks as the core, so its container needs the same two runtime relaxations (`--security-opt seccomp=<tuned profile>` and `--security-opt systempaths=unconfined`). Without them the fail-closed sandbox refuses every script run - the satellite connects but script checks error. These flags were missing from every satellite deployment path.

- satellite-frontend: the "Satellite created" dialog now shows a complete, ready-to-run `docker run` deploy command (including both `--security-opt` flags and the seccomp-profile extract step) instead of just the three environment variables, with a warning that the flags are required for script checks and a link to the sandbox docs.
- The tuned seccomp profile is now bundled INSIDE the satellite image and exposed via a `print-seccomp` entrypoint subcommand (`docker run --rm <image> print-seccomp > checkstack-userns.json`). This is what makes the secure default work in air-gapped networks: the Docker daemon reads the profile from a host file at container-create time and a container cannot relax its own seccomp from the inside, so the operator must place the file before `docker run` - and now it travels with the image (no GitHub, no core round-trip), version-matched to the agent.
- New `docker-compose-satellite.yml` for standalone (remote-host) satellite deployments, with the flags and the extract step documented. The footgun commented-out satellite block in `docker-compose.yml` (which had no `security_opt`) was removed in favor of it.
- Docs: the "Connect a satellite" guide and the script-sandbox "Satellite runtime" section now cover the required flags, the offline profile extract, the bootstrap constraint, and the `unconfined` / `degrade` fallbacks.

This is a beta patch.
