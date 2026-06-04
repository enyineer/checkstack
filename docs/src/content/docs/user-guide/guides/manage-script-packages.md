---
title: "Manage npm packages for scripts"
description: "Curate a pinned allowlist of npm packages, configure your registry, pick a storage backend, and watch per-host sync so your TypeScript scripts can import them everywhere."
---

Checkstack lets you maintain a global, admin-curated allowlist of npm packages that your TypeScript scripts can `import` in every script editor (automation `run_script` actions and inline-script health-check collectors). The central server is the only host that talks to your registry; it resolves and bundles the packages and distributes them to every core instance and satellite, so a script that imports an allowlisted package runs the same everywhere.

This guide covers the **Script Packages** admin page. You need the `script-packages.manage` permission to see it.

## Open the Script Packages page

From the user menu, open **Script Packages**. The page covers install state, vulnerability audit findings, the package allowlist, registry and storage configuration, and per-satellite sync status.

## Add a package to the allowlist

Packages are pinned to an exact version (no ranges) so every host resolves an identical, reproducible tree.

1. In **Allowed packages**, start typing a package name (e.g. `lodash` or `@acme/utils`). A dropdown shows live matches from your configured registry; pick one to fill the name.
2. Choose a version. Picking a package auto-fills its latest version; the version field also suggests the package's other published versions, newest-first. You can type an exact version (e.g. `4.17.21`) by hand instead - versions are pinned (no ranges), and an invalid pin is flagged inline before you can add it.
3. Click **Add**.
4. Click **Install now** in **Install state** to resolve and distribute the set.

The name search and version lookup are proxied through the central server, so they reuse the same registry and auth token your installs use. A private registry works even though your browser can't reach it directly, and the auth token is never sent to the browser.

A script can then import it:

```ts
import groupBy from "lodash/groupBy";

export default async function (context) {
  const grouped = groupBy(context.trigger.payload.items, "status");
  return { count: Object.keys(grouped).length };
}
```

The script editor gives you autocomplete for installed packages as you type. As you type the import name itself, it suggests the installed package names - typing `import {} from "lod"` offers `lodash`. It also suggests the runtime built-ins that are always available without installing anything - the Node and Bun modules like `node:fs`, `node:crypto`, `bun`, and `bun:sqlite` - so typing `import {} from "node:"` lists the Node built-ins. Once a package name is in place, the editor fetches its type definitions on demand, so `import { debounce } from "lodash"` then offers `debounce` and the rest of lodash's API - even for packages whose types ship separately (the editor pulls in the matching `@types/...` automatically). Types refresh after the next install.

Toggle a package off to exclude it from the next install without deleting the entry; the trash icon removes it entirely. Re-run **Install now** after any change.

> [!IMPORTANT]
> Only lightweight, pure-JavaScript packages are supported. Install scripts are disabled by default (a security and size guardrail), so packages that need a postinstall step - native builds, or binary downloads like Puppeteer's Chromium - will not work. The admin page enforces a total-size cap (warns at 150 MB, blocks at 300 MB).

## Configure your registry

If your packages come from an internal registry or proxy (e.g. Artifactory), set the registry URL, any scoped-registry overrides, and an auth token. The token is encrypted at rest and never shown again or logged - the page only indicates whether one is configured.

The central server is the only host that contacts the registry. Satellites and additional core instances pull the resolved package blobs from the central server, so an internally-reachable registry works even when satellites cannot reach it.

## Choose a storage backend and migrate

Resolved package blobs are stored in a content-addressed blob store. Two backends ship in the box:

- **Postgres** (default): no extra infrastructure.
- **S3**: configured via environment variables on the server; preferred at scale.

To move existing blobs from one backend to another, pick a target in **Storage backend** and click **Migrate**. The migration copies every blob, verifies each copy by content hash, and then atomically switches the active backend. Progress (blobs copied) and completion show live. Reads fall back across both backends while it runs, so scripts keep working, and installs are paused until it finishes. If a migration is interrupted, run it again - it resumes where it left off.

## Watch per-host sync

After an install, each core instance and satellite reconciles to the new package set by pulling only the blobs it is missing. The **Satellite sync** section shows each satellite's status (`pending`, `syncing`, `ready`, or `error`). A satellite that cannot sync reports an error and its scripts fail clearly on a package import rather than silently using a stale set.

## Watch for vulnerabilities

Because allowlisted packages (and their transitive dependencies) run inside your scripts, a vulnerability published against an already-installed pinned version is a supply-chain risk. The **Vulnerability audit** section keeps an eye on this for you.

- A scheduled audit runs `bun audit` against the installed package tree once a day. It reports purely from the resolved lockfile against the advisory database - it never executes package code.
- Every finding is recorded and listed in the section, grouped by package with its severity, affected version range, and a link to the advisory. The card badge and the last-run summary show the headline counts by severity.
- When a new vulnerability appears (or an existing one gets worse) at **moderate, high, or critical** severity, every holder of `script-packages.manage` is notified. An unchanged set never re-notifies, so a daily run does not spam you.
- Click **Audit now** to run an on-demand audit. The list refreshes automatically when the audit completes. If an install, migration, or storage cleanup is running, the audit waits and retries on its next scheduled run.

When a finding appears, bump the affected package to a fixed version (or toggle it off) in the allowlist and re-run **Install now**, then **Audit now** to confirm the advisory is gone.

## Reclaim storage

As you change the allowlist over time, blobs from superseded package sets pile up in the store and old package trees accumulate on each host's disk. Cleanup runs automatically once a day, but you can trigger it from **Advanced -> Storage cleanup**:

- Unreferenced blobs are kept for the current package set plus the most recent previous set (for rollback), and only deleted after a 24-hour grace period so an in-flight sync is never disrupted.
- The panel shows the last run (blobs deleted, storage reclaimed) and the total reclaimed to date.
- Click **Run cleanup now** to reclaim immediately. Cleanup is paused while an install or storage migration is running.
