---
title: "Developing Plugins in Isolation"
description: "Develop a Checkstack plugin from its own repo. No monorepo checkout. No upload loop. No Docker bind-mount tricks."
---

Develop a Checkstack plugin from its own repo. No monorepo checkout. No
upload loop. No Docker bind-mount tricks.

```bash
bunx @checkstack/dev-server
```

`@checkstack/dev-server` is the published npm package that ships the
dev server; it exposes a `checkstack-dev` binary so once you've added
it as a devDependency, your `package.json` can wire `"dev":
"checkstack-dev"` and you run `bun run dev` from then on (see the
bootstrap section below). The `bunx @checkstack/dev-server` form is for
a one-shot try before any install.

The command boots the same backend code path Checkstack uses
in production, with two well-defined dev overrides:

- **Filesystem plugin discovery is skipped.** Only your plugin loads —
  nothing else from a `core/` or `plugins/` directory.
- **Auth is synthetic.** Every access rule the platform registers is
  auto-granted to a `dev-user` identity. No login flow.

Your plugin's `register()` runs against a real `PluginManager`, real
`coreServices.*`, real oRPC routing, real Drizzle migrations. The boot
code is the *exact* same module that ships in the production Docker image
— there is no parallel "dev backend" stack to drift from.

When you save a file under `./src`, the backend restarts. Bun cold-starts
in well under a second for a single plugin, so the loop stays tight.

## Prerequisites

1. **Bun installed locally** (`curl -fsSL https://bun.sh/install | bash`).
2. **A running Postgres** reachable at `localhost:5432`. The dev server
   doesn't ship one — it expects one. The smallest setup:

   ```bash
   docker run --name checkstack-dev-pg -d -p 5432:5432 \
     -e POSTGRES_USER=checkstack \
     -e POSTGRES_PASSWORD=checkstack \
     -e POSTGRES_DB=checkstack \
     postgres:16-alpine
   ```

   To point at a different Postgres, pass `--db-url` or set
   `DATABASE_URL`.

3. **A valid plugin `package.json`.** The dev server validates the same
   `installPackageMetadataSchema` the runtime install pipeline uses, so
   missing or malformed fields fail fast before anything boots. See
   [Plugin Distribution & Packing](/checkstack/developer-guide/architecture/plugin-distribution/#anatomy-of-an-installable-plugin)
   for required fields.

## Bootstrap a new plugin repo

A minimal `package.json`:

```jsonc
{
  "name": "@my-org/widget-backend",
  "version": "0.1.0",
  "description": "Widget tracker for Checkstack",
  "author": "ACME Corp",
  "license": "MIT",
  "type": "module",
  "main": "src/index.ts",
  "checkstack": {
    "type": "backend",
    "pluginId": "widget"
  },
  "scripts": {
    "dev": "checkstack-dev",
    "pack": "bunx @checkstack/scripts plugin-pack"
  },
  "dependencies": {
    "@checkstack/backend-api": "^1.0.0",
    "@checkstack/common": "^1.0.0"
  },
  "devDependencies": {
    "@checkstack/scripts": "^0.1.0",
    "@checkstack/dev-server": "^0.1.0",
    "@checkstack/backend": "^1.0.0"
  }
}
```

Your `src/index.ts` exports a `BackendPlugin` as the default export — the
same shape the production runtime expects:

```ts
import { createBackendPlugin, coreServices } from "@checkstack/backend-api";
import { pluginMetadata } from "./plugin-metadata";

export default createBackendPlugin({
  metadata: pluginMetadata,
  register: (env) => {
    env.registerInit({
      deps: { logger: coreServices.logger },
      init: async ({ logger }) => {
        logger.info("Widget plugin initialized");
      },
    });
  },
});
```

Then:

```bash
bun install
bun run dev
# → http://localhost:3000
```

Open the URL. The Plugin Manager UI shows your plugin loaded; any
procedures it exposes are reachable at `/api/<pluginId>/*`.

## Core plugin dependencies are co-loaded

Real plugins almost always depend on platform plugins —
`@checkstack/healthcheck-backend` for a health check strategy,
`@checkstack/notification-backend` for a notification strategy,
`@checkstack/catalog-backend` for a custom catalog kind, etc. The dev
command walks your plugin's `package.json#dependencies` (recursively)
and loads every `@checkstack/*-backend` package it finds alongside the
plugin under dev. Without this, your plugin's `init()` would hit
unregistered services and the boot would deadlock.

Two cases the resolver handles automatically:

- **Transitive backend deps.** If your plugin depends on
  `@checkstack/notification-discord-backend`, which itself depends on
  `@checkstack/notification-backend`, both load.
- **Auto-included dev providers.** When no queue or cache provider is
  in your dep graph (the common case for non-`queue-*` /
  non-`cache-*` plugins), the dev command auto-includes
  `@checkstack/queue-memory-backend` and
  `@checkstack/cache-memory-backend` so the platform's queue and cache
  services have a registered strategy. They're zero-config and fine
  for dev. Operators wire BullMQ / Redis / etc. in production.

You'll see a line like the following in the boot log:

```
📦 Co-loading 3 core plugin deps:
   @checkstack/healthcheck-backend, @checkstack/queue-memory-backend, @checkstack/cache-memory-backend
```

Frontend (`-frontend`) and tooling-type packages are not co-loaded as
backend plugins — they're resolved through their own paths (the Vite
dev server for frontend, transitive type imports for common).

## Frontend plugins

When `package.json#checkstack.type === "frontend"` (or your `-backend`
declares a `-frontend` sibling in `checkstack.bundle`), the dev command
also spawns a Vite dev server with HMR on
[http://localhost:5173](http://localhost:5173). The Vite server proxies
`/api` and `/assets/plugins` to the backend on :3000, so the SPA can
talk to the plugin you just registered.

Behind the scenes, Vite serves `core/frontend`'s `dev-main.tsx` shell —
the same `App.tsx`, `loadPlugins()`, `ThemeProvider`, etc. that ship in
production. Your plugin module is mounted via the
`virtual:checkstack-dev-plugin` alias resolved at config time. Saving a
component in your plugin triggers React Fast Refresh in the browser —
no full reload.

For pure backend plugins, the Vite server is skipped; only port 3000
runs.

## What `bun run dev` does

```mermaid
sequenceDiagram
    participant Dev as Plugin author
    participant DevServer as @checkstack/dev-server
    participant Backend as @checkstack/backend
    participant Watcher as fs.watch on ./src

    Dev->>DevServer: bun run dev (checkstack-dev)
    DevServer->>DevServer: validate package.json
    DevServer->>DevServer: resolve @checkstack/backend
    DevServer->>Backend: spawn `bun run <backend-entry>`<br/>env: CHECKSTACK_DEV_PLUGIN_PATH=cwd<br/>env: CHECKSTACK_DEV_AUTH=true
    Backend->>Backend: skipDiscovery=true; load plugin manually
    Backend->>Backend: register dev auth (auto-grants every rule)
    Backend->>Dev: HTTP 200 on http://localhost:3000
    Watcher-->>DevServer: file change in ./src
    DevServer->>Backend: SIGTERM
    DevServer->>Backend: respawn
```

Two env vars do the work. Both are inert in production — `core/backend`
refuses `CHECKSTACK_DEV_AUTH=true` when `NODE_ENV=production` and ignores
`CHECKSTACK_DEV_PLUGIN_PATH` if unset.

## Command-line flags

```
bunx @checkstack/dev-server --help
```

(After installing `@checkstack/dev-server` as a devDependency, the
binary is on the local `node_modules/.bin` path, so `bun run dev --
--help` or `checkstack-dev --help` both work too.)

| Flag                   | Default                                                                  | Notes                                              |
|------------------------|--------------------------------------------------------------------------|----------------------------------------------------|
| `--cwd <dir>`          | `process.cwd()`                                                          | Plugin directory.                                   |
| `--port <num>`         | `3000` (or `$PORT`)                                                      | Backend HTTP port.                                  |
| `--frontend-port <num>`| `5173` (or `$FRONTEND_PORT`)                                             | Vite dev port. Only used when the plugin (or a bundle sibling) is a `-frontend`. |
| `--db-url <url>`       | `$DATABASE_URL` or `postgresql://checkstack:checkstack@localhost:5432/checkstack` | Postgres URL for core + plugin migrations.    |
| `--no-watch`           | watching enabled                                                         | Disable auto-restart on file changes.               |

## Hitting your plugin

Auth is bypassed, so any browser tab or curl invocation against
`http://localhost:3000/api/<pluginId>/...` authorizes as the dev user
with full access. To test from curl:

```bash
curl -X POST http://localhost:3000/api/widget/listWidgets \
  -H 'content-type: application/json' \
  -d '{"json": {}}'
```

oRPC's `RPCHandler` accepts JSON envelopes; the
[`@orpc/client`](https://orpc.unnoq.com/) packages produce them
automatically if you wire a typed client.

## Logs

The dev server pipes the backend's `stdout` / `stderr` to your terminal
via `stdio: "inherit"`. You see exactly what production logs would show
— Winston-formatted lines including request/response logs, plugin
lifecycle events, and any RPC error stack traces.

## Database state

Migrations run against the live Postgres on every boot. The `plugins`
table tracks your plugin (the dev server also passes through the install
event recorder), so you can hit Plugin Manager → Events to see
register/init traces.

To wipe state and start fresh, drop and recreate the database:

```bash
docker exec -it checkstack-dev-pg \
  psql -U checkstack -c "DROP DATABASE checkstack;"
docker exec -it checkstack-dev-pg \
  psql -U checkstack -d postgres -c "CREATE DATABASE checkstack;"
```

## Validation against production

Before tagging a release, validate that the runtime install path —
metadata schema, compatibility check, install scripts handling — is
happy with what you've built:

```bash
bunx @checkstack/scripts plugin-pack --validate-only
```

For a final smoke test, pack and install via the Plugin Manager UI of a
real Checkstack deployment (or the same dev server's UI). The dev server
loads your plugin via `manualPlugins`; the install path loads it from a
tarball. They exercise the same `register()` / `init()` hooks but not
the same install code path, so the pack-and-install run is a useful
final check.

## Troubleshooting

**`Could not locate @checkstack/backend`**

Make sure `@checkstack/dev-server` is in your devDependencies, and that
the platform package matching your plugin's type is too — `@checkstack/backend`
for a backend plugin, `@checkstack/frontend` for a frontend plugin (or
both for a multi-package plugin that ships frontend + backend together).
The dev server resolves them from your plugin's own `node_modules` (so
the version your plugin pins is what runs). Run `bun install` again.

**Port 3000 in use**

Pass `--port 4000` or set `PORT=4000` in your environment.

**Postgres connection refused**

The dev server expects Postgres on `localhost:5432`. Either start the
Docker container above or pass `--db-url` pointing at a reachable
instance.

**`Plugin package.json failed install-time validation`**

Add the missing field. The error lists the exact path
(`checkstack.pluginId`, `description`, etc.). The validator is the same
Zod schema the runtime install uses — see the
[required fields table](/checkstack/developer-guide/architecture/plugin-distribution/#required-packagejson-fields).

**Restart loop on every save with no actual change**

Editor temp files (Vim swap files, IDE autosave artifacts) can trigger
spurious events. The dev server already filters dotfiles and `~`-suffixed
files. If your editor uses a different pattern, file an issue with the
filename so we can extend the filter.

## Fallback: workspace fork

For deep core debugging — stepping through `core/backend` while a plugin
runs — checking out the upstream Checkstack repo and dropping your
plugin into `plugins/` still works as it always did:

```bash
git clone https://github.com/enyineer/checkstack
cd checkstack
git -C plugins/ clone <your-plugin-repo>
bun install
bun run typecheck:references:generate
bun run dev
```

Use this when the dev server isn't enough — almost always when you're
contributing a core change *alongside* a plugin change.

## See also

- [Plugin Distribution & Packing](/checkstack/developer-guide/architecture/plugin-distribution/) —
  how to ship your plugin once it's working
- [Backend Plugin Development](/checkstack/developer-guide/backend/plugins/) — writing the
  plugin's code itself
- [Frontend Plugin Development](/checkstack/developer-guide/frontend/plugins/)
- [Common Plugin Guidelines](/checkstack/developer-guide/common/plugins/)
