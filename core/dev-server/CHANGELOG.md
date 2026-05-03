# @checkstack/dev-server

## 0.2.0

### Minor Changes

- e90aba5: Split the dev server out of `@checkstack/scripts` into a new
  `@checkstack/dev-server` package.

  **Why**: Previously `@checkstack/scripts` declared `@checkstack/backend`,
  `@checkstack/frontend`, `@checkstack/ui`, `vite`, and
  `@vitejs/plugin-react` as runtime dependencies so the bundled `dev`
  command could spawn a local Checkstack. That made `bunx
@checkstack/scripts plugin-pack` (and any other CLI usage) resolve the
  platform's full transitive dep graph from npm — which broke the
  `Version Packages` release run when one of those transitives
  (`@checkstack/cache-api@0.1.0`) hadn't been published yet, blocking
  plugin-pack validation for 40 plugins.

  **What changed**:

  - New package `@checkstack/dev-server` with the bin `checkstack-dev`. It
    owns the dev loop (backend spawn, Vite, file watcher) and is meant to
    be installed as a `devDependency` in plugin repos.
  - `@checkstack/backend` and `@checkstack/frontend` are _optional_ peer
    dependencies of dev-server; plugin authors only declare the one
    matching their plugin type.
  - `@checkstack/scripts` runtime deps slimmed to `@checkstack/common`,
    `tar`, `inquirer`, `handlebars`. The `dev` command was removed from
    the CLI (it had not shipped to users yet).
  - Plugin scaffolding templates now produce `dev` scripts that call
    `checkstack-dev` directly and add `@checkstack/dev-server` plus the
    matching platform package as devDependencies.
  - Documentation updated to reflect the new dev-loop entry point.

  Both bumps are minor since the project is in beta — the removed `dev`
  command and dropped transitive deps would normally be a major bump.

### Patch Changes

- @checkstack/backend@0.9.0
- @checkstack/common@0.8.0
- @checkstack/frontend@0.5.0
