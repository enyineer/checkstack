---
title: "Install a plugin"
description: "Install a Checkstack plugin from npm, a GitHub release, or a tarball upload using the Plugin Manager UI."
---

Checkstack ships a runtime Plugin Manager that installs plugins from npm, GitHub releases, or direct tarball upload. This page walks you through using it. For the packaging mechanics behind each source (what plugin authors have to do), see [Plugin distribution and packing](/checkstack/developer-guide/architecture/plugin-distribution/).

## Install via the Plugin Manager UI

1. Open the user menu -> **Plugin Manager**.
2. Click **Install plugin**.
3. Pick a tab:
   - **NPM** - paste the package name and (optionally) version + custom registry.
   - **Tarball Upload** - drag-and-drop a `.tgz`.
   - **GitHub Release** - owner / repo / tag, plus optional GitHub Enterprise fields.
4. Click **Preview install**. The platform fetches metadata and runs the compatibility check. The confirmation modal shows what will be installed, security warnings, and any blockers.
5. Type the plugin name to confirm. Install proceeds; the page refreshes to the Installed Plugins list when complete.

## Typical install failures

Failures surface inline in the modal (not the dreaded "Internal Server Error"). Common messages:

- `Package 'foo@latest' not found on the npm registry.`
- `GitHub release 'owner/repo@v1.0.0' not found. Verify the owner, repo, and tag…`
- `Plugin '@org/foo' requires @checkstack/backend-api@^2.0.0 but this platform has 1.5.0.`
- `Tarball for '@org/foo' is 73.4MB, which exceeds the 50MB platform limit.`

## Audit trail

The audit log of every install and uninstall (including in-flight failures across multi-instance deployments) is at **Plugin Manager -> Events**.

## See also

- [Plugin distribution and packing](/checkstack/developer-guide/architecture/plugin-distribution/) - how plugin authors prepare a plugin so it can be installed here.
