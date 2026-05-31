---
title: "Script Health Checks"
description: "Run shell scripts and inline TypeScript/JavaScript modules as health checks. Both execute on the satellite, with editor IntelliSense, ESM imports, and a hardened isolation model."
---

> [!NOTE]
> For developers writing custom strategies, see [Health Check Strategy Development](/checkstack/developer-guide/backend/healthchecks/strategies/).

The Script health check plugin exposes two collectors that run on whatever
satellite the check is bound to:

- **Shell Script** - your text is fed to `sh -c`, so pipes, redirects,
  variable expansion, `if`/`for`/`while`, command substitution, etc.
  behave exactly like they do in a terminal.
- **Inline Script** - your text is executed as a real ES module by a
  freshly-spawned Bun subprocess, so you can `import` from `node:os`,
  `node:fs/promises`, `node:child_process` and so on, use top-level
  `await`, and return your result via `export default`.

Use shell when the check is naturally a one-liner over the system
(`awk`, `curl`, `df`, ...); use inline TS/JS when you want a real
programming language with the Node/Bun standard library at hand.

## Shell scripts

The collector takes one field, `script`, plus optional `cwd`, `env`, and
`timeout`. Exit code 0 is healthy; anything else is unhealthy. stdout
and stderr are captured and shown with the run.

### Example - fail when 1-minute load average exceeds 0.60

```sh
load=$(uptime | sed 's/.*load average[s]*: //' | awk '{ print $1 }' | tr -d ',')
awk -v l="$load" -v t=0.60 'BEGIN { exit (l+0 > t) ? 1 : 0 }'
echo "load_ok=$load"
```

That works precisely because the script is run through `sh -c` -
`awk`, the `$(...)` command substitution, the pipes, and the `-v` flag
passing are all handled by the shell, not by `Bun.spawn` parsing argv.

We use `uptime | …` rather than `awk '{print $1}' /proc/loadavg` so
the same script runs on Linux _and_ macOS satellites. The two `uptime`
formats differ slightly (Linux: `load average: 0.00, 0.01, 0.05`;
macOS: `load averages: 0.45 0.55 0.65`); the `sed`/`tr` pipeline above
handles both.

### Available environment variables

The satellite forwards only a curated whitelist to the script:
`PATH`, `HOME`, `USER`, `LANG`, `LC_ALL`, `LC_CTYPE`, `TZ`, `TMPDIR`,
`HOSTNAME`, `SHELL`. **Everything else is stripped**, including any
secrets the satellite process itself was started with. You can add
custom vars (e.g. `API_TOKEN`) via the collector's `env` field, in
which case they're merged on top of the whitelist for that one
invocation.

### Run context (reserved variables)

The satellite also injects a set of reserved variables that describe
the run, so the script knows which check and which system it's running
for:

- `CHECKSTACK_CHECK_ID` - the health check configuration id.
- `CHECKSTACK_CHECK_NAME` - the check's display name (falls back to the id).
- `CHECKSTACK_CHECK_INTERVAL_SECONDS` - the configured run interval in seconds.
- `CHECKSTACK_SYSTEM_ID` - the id of the system being checked.
- `CHECKSTACK_SYSTEM_NAME` - the system's display name (falls back to the id).

These are merged on top of the whitelist for that one invocation. A
user-supplied `env` value with the same name overrides the injected
one.

```sh
echo "checking ${CHECKSTACK_CHECK_NAME} for system \"$CHECKSTACK_SYSTEM_NAME\""
echo "next run in ${CHECKSTACK_CHECK_INTERVAL_SECONDS}s"
```

### Working directory

`cwd` is optional and defaults to the satellite's current directory.
Set it explicitly when your script reads relative paths.

## Inline scripts (TypeScript / JavaScript)

The collector takes a `script` field - a TypeScript/JavaScript module
source - plus a `timeout`. The runner exposes a `globalThis.context`
runtime global (`context.config`, `context.check`, `context.system`)
and otherwise gives you the full Node/Bun stdlib.

### Example - load average via `node:os`

```ts
import { loadavg } from "node:os";
import { defineHealthCheck } from "@checkstack/healthcheck";

const load = loadavg()[0];
export default defineHealthCheck({
  success: load < 0.60,
  message: `1m load average is ${load.toFixed(2)}`,
  value: load,
});
```

That `import { loadavg } from "node:os"` works because the user
script is written to a temp `.mjs` file and executed by Bun as a
real ESM module - there's no eval, no `Function` constructor, no
Web Worker; it's an actual subprocess that can do everything a
standalone Bun script can.

`defineHealthCheck` from the virtual `@checkstack/healthcheck`
module is recommended but optional. It's a runtime identity
function - its only job is to assert at the type level that you
return a valid `HealthCheckScriptResult`, so the editor catches
mistakes like `{ success: "yes" }` before the script ever runs.

### Run context (`context.check` and `context.system`)

Alongside `context.config`, `globalThis.context` exposes the run
context describing which check and which system the run is for:

- `context.check`: `{ id: string; name: string; intervalSeconds: number }`
  - `name` falls back to the id when no display name is set.
- `context.system`: `{ id: string; name: string }`
  - `name` falls back to the id when no display name is set.

The inline-script editor types these, so they autocomplete.

```ts
import { defineHealthCheck } from "@checkstack/healthcheck";

export default defineHealthCheck({
  success: true,
  message: `${context.system.name} checked every ${context.check.intervalSeconds}s`,
});
```

### Result shape

`export default` whatever shape fits - the runner normalises it:

| Returned value                                           | Treated as                                                |
| -------------------------------------------------------- | --------------------------------------------------------- |
| `{ success: true, message?: string, value?: number }`    | The literal result (`value` feeds the metric chart).      |
| `true` / `false`                                         | `success` of that boolean.                                |
| `number`                                                 | `success: true`, with `value` set to that number.         |
| `undefined` (or no `export default`)                     | `success: true`.                                          |
| _(throws)_                                               | `success: false`, error message comes from the throw.     |

You can also `export default async (context) => ...` if you want a
function form - the runner awaits the call with the context object.

### Backwards compatibility - legacy `return X;`

Scripts written for the older inline-script collector that used
`return { success: ... }` at the top level still work. If your source
has no `import` or `export` at the top, the runner wraps it in an
async IIFE that becomes the default export:

```ts
// Legacy - still valid
return { success: true, message: "All good" };
```

You only need `export default` once you start mixing in real ESM
features (`import ...`, top-level `await`).

### Editor support

The configuration UI uses a VS Code-powered code editor with full TypeScript IntelliSense:

- The real upstream `@types/node` and `bun-types` declaration files
  are mounted as a virtual filesystem (lazy-loaded as a separate JS
  chunk when you open the editor), so `loadavg`, `readFile`, `spawn`,
  the `Bun` global, `process.env`, etc. all autocomplete and check.
- `context.config` is typed from the collector's own JSON Schema, so
  the fields you've added to the configuration are autocompletable
  from inside the script. `context.check` and `context.system` are
  typed too, so the run-context fields autocomplete as well.
- A virtual `@checkstack/healthcheck` module exposes `defineHealthCheck`
  and the `HealthCheckScriptResult` interface - when you write
  `export default defineHealthCheck({ ... })`, the editor type-checks the
  object literal against the expected shape and flags mistakes inline.
- DOM types (`AudioContext`, `Canvas`, ...) are deliberately excluded
  to keep the suggestion list focused on the backend surface.
- When you open an empty inline-script field, the editor is pre-seeded
  with a runnable starter that imports `node:os` and uses
  `defineHealthCheck` so you have a working example to copy from.
- The expand icon in the editor's top-right corner opens the same editor
  in a large full-screen overlay (with identical IntelliSense and
  completions) so you can comfortably edit longer scripts. Edits made in
  the overlay sync back to the inline editor.

For shell scripts, the editor offers env-var autocomplete: typing `$`
or `${` brings up the platform-forwarded vars (`PATH`, `HOME`, `TZ`,
...). The integration shell editor extends this list with the
event-injected vars (`EVENT_ID`, `DELIVERY_ID`, `PAYLOAD_*` flattened
from the event payload).

### Logging

Anything you write to stdout (`console.log`, `console.info`, ...) is
captured and surfaced as the run's message when your script doesn't
return an explicit `message`. stderr is also captured but reserved
for the runner's result marker - your `console.error` calls survive
the parse and are propagated.

## Concurrency and cleanup

Both collectors are safe to run in parallel against the same
satellite. Each invocation:

- Spawns its own subprocess (`sh -c` for shell, `bun runner.mjs` for
  inline) with its own stdout/stderr pipes.
- For inline scripts only: gets its own temp directory created via
  `mkdtemp` (POSIX-guaranteed unique), so two parallel runs can
  never read each other's `user.mjs`.
- Tags its result with a UUID-based marker, so even if a user script
  happens to write the literal text of another invocation's marker
  to stderr, parsing stays unambiguous.

Cleanup is in `finally` - the temp directory is removed and any
subprocess is killed, on success, on throw, and on timeout. The
internal timeout handle is cleared explicitly so a fast script
doesn't leak an event-loop timer past return.

## Security model

The plugin assumes you trust the user to write scripts that run on
the satellite. There is **no sandbox** - `sh -c` runs as the
satellite process's UID, and the inline-script subprocess inherits
the same. What we _do_ guarantee:

- Only the whitelisted env vars (see above) are forwarded, so secrets
  from the parent process are not visible to the script.
- The user's `import` statements load files from the satellite's
  module graph; they do not load anything from the network unless
  the script itself calls `fetch`.

If you need stronger isolation for less-trusted authors, deploy a
dedicated satellite with its own UID and resource limits, and bind
the scripted health checks to that satellite.

## Working with existing checks

The shell collector was migrated from a `{ command, args }` shape to
a single `script` field at platform version 2. Existing checks are
auto-migrated on load - your old command + args are joined into one
script string with POSIX single-quote escaping, so the behaviour is
preserved verbatim. You can edit the resulting script to take
advantage of the new shell features (pipes, conditionals, ...) any
time.
