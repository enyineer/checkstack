---
title: "Plugin troubleshooting"
description: "Fixes for plugin install, upgrade, and uninstall problems - registry errors, version mismatches, install-script warnings, and what happens to your data."
---

This page covers the failure modes you hit while installing, upgrading, or removing plugins through the Plugin Manager. For the install walkthrough see [Install a plugin](/checkstack/user-guide/guides/install-a-plugin/).

## Install fails

### Symptom: "Tarball exceeds maximum size"

The plugin tarball is larger than the platform's 50 MB ceiling.

**How to verify** - the error message includes the actual size.

**Fix** - this limit is hardcoded; there is no env var or UI knob. Ask the plugin author to slim the package (typically by adding a tighter `files` field to `package.json` so dev artifacts aren't shipped). If you control the plugin, repack with `bunx @checkstack/scripts@latest plugin-pack` after pruning.

### Symptom: "Failed to peek tarball"

The uploaded `.tgz` is corrupted or missing the required `package.json`/`checkstack` metadata.

**Fix**:

1. Re-download or re-pack the artifact.
2. Confirm the package was packed with `bunx @checkstack/scripts@latest plugin-pack` (not `bun pm pack` directly). The pack CLI validates the `checkstack` metadata block before producing the tarball.

### Symptom: npm install fails with `404 Not Found`

The npm registry doesn't have the package at the requested version.

**Fix**:

1. Double-check the package name and version spelled in the install dialog.
2. If the package is private, configure the npm registry credentials in **Settings -> Infrastructure**. The npm installer honours the registry config the platform-wide.
3. Confirm the version actually exists with `npm view @org/pkg versions`.

### Symptom: GitHub install can't reach the release

The GitHub installer fetches a release asset by URL. Failures here are almost always network or auth.

**Fix**:

1. Check the Checkstack container can reach `https://github.com` and `https://objects.githubusercontent.com` outbound.
2. For private repos, the release asset must be accessible without auth, or you must configure a GitHub token in the integration settings.
3. Verify the release URL points to a `.tgz` asset, not a source archive.

### Symptom: install warns about install scripts

The plugin's `package.json` sets `checkstack.allowInstallScripts: true`. The platform refuses to silently run lifecycle scripts (`preinstall`, `postinstall`, ...) - it shows a warning and asks for explicit confirmation.

**Fix** - read the plugin's docs/source to confirm what the script does. If you trust it, click Install to proceed. If you don't, don't install. This warning is loud on purpose; install scripts run with the same permissions as the Checkstack process.

### Symptom: "Plugin signature could not be verified"

Reserved for a future signed-plugin flow. Current v1.0 BETA installs do not require signatures, so if you see this you're on a build that has signature enforcement turned on - either install from a trusted source that signs releases or temporarily relax the policy in Infrastructure settings.

## Version compatibility

Checkstack v1.0 is **BETA**. The platform follows semver and treats every release as potentially containing breaking changes until v1.0 stable.

| Situation | What to do |
|-----------|------------|
| Plugin built against a newer core API | Update the core first; plugins generally tolerate newer cores within the same minor. |
| Plugin built against a much older core | Update the plugin. Plugins built for pre-v1.0 cores have no compatibility guarantee. |
| Bundle install with mixed versions | The pack CLI emits a single bundle manifest with one primary version; if a sibling is mismatched, repack the bundle. |

> [!IMPORTANT]
> Per the changesets rule, the platform is currently in BETA and only bumps minor versions even for breaking changes (with a BREAKING CHANGES note in the changeset). Treat every minor bump as a potential plugin-compatibility checkpoint and read the changelog before upgrading.

## Upgrade behaviour

### When a new plugin version is published, does Checkstack pick it up?

No. The platform never upgrades plugins on its own. You upgrade explicitly through the Plugin Manager.

### Does restarting the container upgrade plugins?

On restart, the platform re-loads every `is_uninstallable=true` row in the `plugins` table from the `plugin_artifacts` store. It does **not** re-fetch from npm/GitHub; the tarball in the database is the source of truth. So a restart preserves the exact version you installed, even if upstream has moved on.

### What about core plugins (the built-in ones)?

Core plugins ship inside the Checkstack image. Pulling a newer image upgrades them as a set. There is no per-core-plugin version pinning.

## Uninstall behaviour

When you uninstall a runtime plugin from the Plugin Manager, three pieces of state can be touched. The UI exposes each as an explicit toggle on the uninstall preview screen:

| State | What it is | What you choose |
|-------|------------|-----------------|
| Plugin row + tarball | The `plugins` and `plugin_artifacts` rows for the plugin. Always removed on uninstall. | No choice. |
| Plugin Postgres schema | The per-plugin schema (`plugin_<id>`) holding the plugin's tables. Drops everything the plugin ever stored. | "Delete schema" toggle. **Defaults to off**. |
| Plugin configs | Per-plugin configuration rows in `plugin_configs`. | "Delete configs" toggle. **Defaults to off**. |

The defaults are conservative on purpose: an uninstall is reversible (re-install the same plugin and the configs/data are still there) as long as you don't tick those toggles.

> [!CAUTION]
> Ticking "Delete schema" drops the plugin's data tables with `DROP SCHEMA ... CASCADE`. There is no undo. Take a Postgres backup first if you might want the data back.

### Cascading uninstalls

If other installed plugins declare a `@checkstack/<id>` dependency on the plugin you're removing, the preview screen shows them as **Dependents**. You then choose:

- Uninstall without cascade -> the platform refuses (would leave dangling deps).
- Uninstall with cascade -> the platform walks the dependents transitively and uninstalls them too, in dependency order. Each dependent honours the same "delete schema" / "delete configs" toggles you picked.

### Core plugins cannot be uninstalled

The Uninstall action is hidden for any plugin where `isUninstallable=false`. Those are the built-in core plugins; removing them would brick the platform. Use the official Docker image to swap the core itself.

## "Plugin loaded on one replica but not another"

In a multi-replica deployment, every install/uninstall is broadcast to every replica. If a single replica didn't pick the install up, check the **Plugin Manager -> Plugin events** page - each lifecycle event is recorded per replica, so you can see exactly which one failed and why.

Most-common causes:

- The failing replica was restarting at the moment of the broadcast and missed it. Hitting the restart endpoint on the failing replica forces a re-bootstrap from `plugin_artifacts` (which contains the install tarball regardless of the original source).
- The failing replica's `INTERNAL_URL` is wrong, so the broadcast couldn't be acked back to the originator.

## Where to go next

- [Install a plugin](/checkstack/user-guide/guides/install-a-plugin/) - the install walkthrough.
- [Plugin distribution](/checkstack/developer-guide/architecture/plugin-distribution/) - the developer-facing distribution rules.
- [Plugin system architecture](/checkstack/developer-guide/architecture/plugin-system/) - lifecycle and multi-instance coordination details.
