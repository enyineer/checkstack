---
title: Upgrading
description: How to pin image tags, plan a safe upgrade, and what the BETA versioning policy means for your operations.
---

Checkstack ships a new Docker image on every release. Upgrades are usually one image tag bump away, but the BETA status of the project changes the safety story compared to a v1.x-style stable SemVer. This page covers the policy, the practical steps, and the one footgun (`:latest`) you must avoid.

## The current version policy

Checkstack is **BETA software** at the time of writing. The platform's versioning works as follows:

- All packages follow semantic-ish version numbers, but **breaking changes ship as minor version bumps**, not major. This is the explicit project policy while in BETA.
- Breaking changes are always called out in the release notes under a "Breaking changes" heading. Read the notes for every minor bump.
- Patch versions never include breaking changes. They are safe to pick up automatically once you have a green CI run on a representative pre-prod environment.

> [!IMPORTANT]
> Because breaking changes can hide in a minor bump, you cannot upgrade Checkstack the way you would upgrade a v3.x-stable library. Read the release notes before any minor-version upgrade. Treat every minor as if it could be a major.

When Checkstack reaches v1.0 stable, this policy will change to standard SemVer (breaking changes only in majors). Until then, plan for the BETA behaviour.

## Pin your image tag

> [!CAUTION]
> Never use `:latest` in a production deployment. `latest` is whatever was published most recently and changes silently the next time someone pulls the image. That makes upgrades non-deterministic and rollbacks lossy.

Always pin to a specific version:

```yaml
# docker-compose.yml
services:
  checkstack:
    image: ghcr.io/enyineer/checkstack:<version>
```

```yaml
# Kubernetes
containers:
  - name: checkstack
    image: ghcr.io/enyineer/checkstack:<version>
```

Replace `<version>` with the exact tag you want to run (for example, the latest entry from [GitHub releases](https://github.com/enyineer/checkstack/releases)). When you decide to upgrade, change the tag on purpose. Your version control system (Git) is now the canonical record of what version you ran when.

> [!TIP]
> If you prefer not to chase patch releases manually, pin to a minor-locked tag where the project publishes one (for example, the leading `<major>.<minor>` segment). The minor still moves but you avoid being surprised by a minor bump.

## Before you upgrade

The two-minute pre-flight check:

1. **Read the release notes.** GitHub releases at [https://github.com/enyineer/checkstack/releases](https://github.com/enyineer/checkstack/releases) list breaking changes, new features, and bug fixes for each version.
2. **Have a recent database backup.** Checkstack stores plugin artifacts and encrypted secrets in Postgres. A backup is your only rollback path if a migration fails. See the backup notes in [Docker Compose](/checkstack/user-guide/installation/docker-compose/) or your Kubernetes Postgres operator docs.
3. **Note your `ENCRYPTION_MASTER_KEY`.** You will need it after restore. Losing it means losing every encrypted secret.
4. **Plan downtime.** Single-replica deployments take a brief outage during the restart. Schedule the window.

## The upgrade itself

### Docker Compose

```bash
# 1. Edit docker-compose.yml: bump the image tag.
# 2. Pull the new image:
docker compose pull checkstack

# 3. Recreate the container:
docker compose up -d --force-recreate
```

The new container starts, runs database migrations for every plugin, and flips readiness to true when init completes. Watch the logs:

```bash
docker compose logs -f checkstack
```

### Kubernetes

```bash
# 1. Edit deployment.yaml: bump the image tag.
# 2. Apply:
kubectl apply -f deployment.yaml

# 3. Watch the rollout:
kubectl -n checkstack rollout status deploy/checkstack
```

With `strategy.type: Recreate` (recommended for single-replica deployments), Kubernetes stops the old pod and starts the new one in sequence. The Service stops sending traffic until the readiness probe is green, so users see "service unavailable" rather than partial responses while migrations run.

> [!NOTE]
> Migrations run automatically on startup. There is no separate migration step you need to schedule. Each plugin owns its own Postgres schema and applies its own migrations on boot.

## Runtime-installed plugins after a restart

Plugins installed at runtime (via the Plugin Manager UI from npm, GitHub, or uploaded tarballs) are persisted in Postgres as `bytea` blobs in the `plugin_artifacts` table. On boot, the platform loads every plugin from that table.

That means:

- After a restart (upgrade or otherwise), all your runtime-installed plugins come back without you doing anything.
- A fresh replica boot reconstructs the full plugin set from the database.
- You do not need to "reinstall" plugins after every upgrade.

> [!TIP]
> Because plugin artifacts live in the database, your Postgres backup also backs up your plugin set. Restoring the database to a fresh container also restores its plugins.

## After the upgrade

A quick post-flight check:

1. **Hit `/.checkstack/ready`.** It should return 200. If it returns 503 for more than a few minutes, see [Installation troubleshooting](/checkstack/user-guide/troubleshooting/).
2. **Log in.** Open `BASE_URL` and confirm the UI loads. New features from the release notes should be visible.
3. **Verify health checks still run.** Open a system detail page and confirm the latest run timestamp is recent.
4. **Verify external delivery still works.** Send a test notification or check the integrations delivery log for recent success entries.
5. **Watch the logs for an hour.** Some misconfigurations only surface under traffic.

## Rolling back

Rollback is the same flow in reverse: change the image tag back, restart the container. There are two caveats:

- **Database migrations are not auto-reversed.** Most Checkstack migrations are additive (new columns with defaults, new tables); those are safe to leave behind when running an older image. Destructive migrations are the exception; if the release notes flag one, plan to restore the database from backup as part of the rollback rather than just changing the tag.
- **Runtime plugins built against the new core may not load against the old core.** If you upgraded plugin versions through the Plugin Manager during the same window, downgrade them as well or be ready to remove the incompatible ones from the UI.

For anything more complex than a quick patch-version revert, restoring from your Postgres backup is the cleanest path.

## Special-case: changes that touch encryption

When a release explicitly calls out an encryption-related change (a new key derivation, a re-encryption pass, ...) you may need extra steps beyond a tag bump. The release notes will spell out the procedure. Common patterns:

- **Background re-encryption job.** New code re-encrypts existing rows in the background on boot. You can keep using the system; just wait for the job to finish before rotating the master key.
- **Manual rotation step.** The notes give a CLI command or admin UI action. Run it once after upgrading and before deleting any old key material.

See [Secret encryption](/checkstack/user-guide/reference/secret-encryption/) for the underlying model.

## Long-running deployments

Two patterns that matter over time:

- **Keep up with patches.** Patch releases include bug and CVE fixes. Falling behind makes future upgrades scarier because you have to absorb many minors at once.
- **Re-test backup restores periodically.** A backup you have never restored from is not a backup. Pick a quarterly cadence to restore your dump to a throwaway environment and confirm the restored stack starts.

## Where to go next

- [Docker Compose](/checkstack/user-guide/installation/docker-compose/) and [Kubernetes](/checkstack/user-guide/installation/kubernetes/) for the day-1 install.
- [Configuration reference](/checkstack/user-guide/reference/) for every environment variable a release might add.
- [Installation troubleshooting](/checkstack/user-guide/troubleshooting/) for common upgrade failures.
- [Secret encryption](/checkstack/user-guide/reference/secret-encryption/) for the encryption model and rotation flow.
