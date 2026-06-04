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

When the run resolved an environment for the system, the satellite also
injects the environment's id, name, and one variable per custom field:

- `CHECKSTACK_ENV_ID` - the environment id.
- `CHECKSTACK_ENV_NAME` - the environment's display name.
- `CHECKSTACK_ENV_<FIELD>` - one variable per custom field, where `<FIELD>`
  is the field key normalized to `UPPER_SNAKE_CASE`. A camelCase key is split
  on its boundaries, so `baseUrl` becomes `CHECKSTACK_ENV_BASE_URL` and
  `region` becomes `CHECKSTACK_ENV_REGION`. Non-string values are stringified
  (numbers and booleans verbatim, objects and arrays as JSON).

> [!NOTE]
> If two custom field keys normalize to the same variable name (for example
> `baseUrl` and `base-url`), the first one wins and the later one is skipped
> with a warning, rather than silently overwriting. When the run has no
> environment (the system has none, or the assignment opts out), no
> `CHECKSTACK_ENV_*` variables are injected.

These are merged on top of the whitelist for that one invocation. A
user-supplied `env` value with the same name overrides the injected
one (including any `CHECKSTACK_ENV_*` variable).

```sh
echo "checking ${CHECKSTACK_CHECK_NAME} for system \"$CHECKSTACK_SYSTEM_NAME\""
echo "next run in ${CHECKSTACK_CHECK_INTERVAL_SECONDS}s"
echo "base url for this environment: ${CHECKSTACK_ENV_BASE_URL}"
```

### Working directory

`cwd` is optional and defaults to the satellite's current directory.
Set it explicitly when your script reads relative paths.

## Inline scripts (TypeScript / JavaScript)

The collector takes a `script` field - a TypeScript/JavaScript module
source - plus a `timeout`. The runner exposes a `globalThis.context`
runtime global (`context.config`, `context.check`, `context.system`,
`context.environment`) and otherwise gives you the full Node/Bun stdlib.

### Example - load average via `node:os`

```ts
import { loadavg } from "node:os";
import { defineHealthCheck } from "@checkstack/sdk/healthcheck";

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

`defineHealthCheck` from the `@checkstack/sdk/healthcheck`
module is recommended but optional. It's a runtime identity
function - its only job is to assert at the type level that you
return a valid `HealthCheckScriptResult`, so the editor catches
mistakes like `{ success: "yes" }` before the script ever runs.

> [!IMPORTANT]
> **Breaking change:** the helper import moved from the old bare
> `@checkstack/healthcheck` module to the `@checkstack/sdk/healthcheck`
> subpath of the published [`@checkstack/sdk`](/checkstack/) package. The old
> bare-name import no longer resolves - update existing scripts to
> `import { defineHealthCheck } from "@checkstack/sdk/healthcheck"`. The helper
> name and behaviour are unchanged; only the module specifier moved.

### Run context (`context.check`, `context.system`, `context.environment`)

Alongside `context.config`, `globalThis.context` exposes the run
context describing which check, system, and environment the run is for:

- `context.check`: `{ id: string; name: string; intervalSeconds: number }`
  - `name` falls back to the id when no display name is set.
- `context.system`: `{ id: string; name: string }`
  - `name` falls back to the id when no display name is set.
- `context.environment`: `{ id: string; name: string; fields: Record<string, unknown> }`
  - Present only when the run resolved an environment. `fields` holds the
    environment's custom metadata with the original (non-normalized) keys, so
    you read `context.environment.fields.baseUrl` directly. When the run has
    no environment, `context.environment` is `undefined`.

The inline-script editor types these, so they autocomplete.

```ts
import { defineHealthCheck } from "@checkstack/sdk/healthcheck";

const baseUrl = context.environment?.fields.baseUrl ?? "http://localhost";
export default defineHealthCheck({
  success: true,
  message: `${context.system.name} (${context.environment?.name ?? "no env"}) at ${baseUrl}`,
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
- The `@checkstack/sdk/healthcheck` module exposes `defineHealthCheck`
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

Script and shell health checks run inside a layered OS-level sandbox
that is **enabled by default**. The hardening lives in the shared
script runners, so it applies on whichever pod or satellite claims the
run, and what it can enforce depends on the host's capabilities. What
it always guarantees:

- Only the whitelisted env vars (see above) are forwarded, so secrets
  from the parent process are not visible to the script.
- Forbidden env keys supplied by a check/action (`LD_PRELOAD`,
  `LD_LIBRARY_PATH`, `DYLD_*`, `NODE_OPTIONS`, `BUN_INSTALL`,
  `BUN_CONFIG_*`, and a caller `PATH` override) are dropped before the
  child starts. The curated safe `PATH` is still forwarded.
- Captured output is capped (5 MiB by default) and flagged when
  truncated.
- The user's `import` statements load files from the satellite's
  module graph; they do not load anything from the network unless the
  script itself calls `fetch`.

On a capable Linux host (with `prlimit` available, running as root) the
run is additionally capped on CPU time, address space, open files,
process count, and single-file write size via `setrlimit`, and can be
dropped to a dedicated low-privilege UID. On hosts that lack those
primitives (macOS, restricted containers, non-root), those strong
layers degrade to the portable subset above and are reported per run
rather than silently assumed.

When a namespace wrapper (`bwrap` or `nsjail`) is installed, two more
layers become available:

- **Filesystem isolation.** `filesystem.mode: "scratch-only"` confines
  the script to its per-run scratch directory (writable) over a
  read-only minimal base system; `"scratch-plus-ro"` additionally
  read-only binds the managed `node_modules` tree so package imports
  still resolve. The language interpreter is bound in automatically, and
  `$TMPDIR` is pinned to the in-namespace `/tmp`.
- **Network egress control.** `network.mode: "deny"` drops the script
  into a fresh network namespace with loopback only - no outbound
  egress at all, covering `fetch`, raw sockets, and DNS at the kernel
  level. A fresh namespace is routeless, so "no egress" is the default
  and any wrapper (`bwrap` or `nsjail`) delivers `deny`.
  `network.mode: "allowlist"` permits only the listed IPv4/IPv6 CIDRs
  (v1 is IP/CIDR only; resolve domains yourself or front them with an
  egress proxy). Because a fresh namespace is routeless, `allowlist`
  additionally plumbs real egress into it - either a privileged `nsjail`
  macvlan uplink, or a rootless `slirp4netns` userspace stack on
  unprivileged hosts - so the allowed destinations are actually
  reachable, then filters with nftables. When
  `denyLinkLocalAndMetadata` is on (the default) the
  link-local and cloud-metadata ranges (`169.254.0.0/16`, `fe80::/10`,
  `fc00::/7`) are always blocked, so a script cannot reach
  `169.254.169.254` to exfiltrate instance credentials.

  Reachability matters: `allowlist` and the always-on metadata block
  only engage when real egress can be plumbed, by one of two paths.

  - **Privileged macvlan** (`nsjail` running as root + a usable host
    interface): the macvlan interface comes up unaddressed and has no
    route, so a static address triple is required or the allowlist would
    blackhole the allowed destinations. Supply it explicitly with the
    `CHECKSTACK_SANDBOX_MACVLAN_IP`, `CHECKSTACK_SANDBOX_MACVLAN_NM`, and
    `CHECKSTACK_SANDBOX_MACVLAN_GW` environment variables (deriving a
    free address and the default gateway from the host automatically is a
    collision/TOCTOU footgun, so it is taken from the operator).
  - **Rootless slirp4netns** (`bwrap` + unprivileged user namespaces +
    `slirp4netns` on PATH): a userspace TCP/IP stack with deterministic
    built-in addressing - no root, no host interface, and no operator
    configuration needed. The platform loads the nftables filter
    fail-closed (default-drop before the device comes up), so there is no
    unfiltered window. This is the common rootless-container case.

  The privileged path is preferred when available, then the rootless
  path. On a host that can deliver NEITHER (user namespaces disabled, no
  wrapper, or non-Linux), `allowlist` and the metadata block do **not**
  engage a routeless namespace - that would blackhole all traffic,
  including the allowed destinations. Instead they keep the host network
  and the gap is reported per run. `deny` (loopback-only) always works
  wherever a namespace can be created.

The filesystem and network layers compose into a single wrapper
invocation: enabling network confinement makes the same wrapper take a
fresh network namespace instead of sharing the host's, so the two
layers never fight. On a host without a namespace wrapper (or on macOS),
both layers degrade to "off" and the gap is reported per run. The
reported `enforced.network` flag always reflects reality - it is never
true when egress is actually severed or unfiltered.

> [!IMPORTANT]
> The shipped default profile is **secure by default**: egress is DENIED
> (network `allowlist` with an empty allow list) until an operator
> allowlists the destinations a script may reach, and the always-on
> metadata/link-local block closes SSRF-to-metadata exfil. A script that
> calls an external HTTP API will not reach it until that destination is
> allowlisted in the global default.

### Global-only policy and opt-out

The sandbox policy is **global, not per item**. There is no per-check or
per-action `sandbox` field: a check or automation author cannot weaken
or disable the sandbox on their own item. The whole sandbox is enabled
by default (generous CPU/memory headroom, filesystem confined to a
per-run scratch dir plus read-only managed packages, egress denied, and
a privilege drop when a dedicated low-privilege UID is configured).
Configure the dedicated target with `CHECKSTACK_SANDBOX_UID` /
`CHECKSTACK_SANDBOX_GID`; without it the privilege layer degrades to
`inherit` and is reported per run.

The policy is read at run time from a durable, cluster-wide setting
stored in the shared database (not a per-pod value), so it reads the
same on every pod. To change it for the whole install, store a policy
under the global sandbox default - for example `{ enabled: false }` to
opt the entire deployment out, or an egress allowlist that every script
may use:

```ts
// Global sandbox default (cluster-wide), e.g. to allow specific egress:
{
  network: {
    mode: "allowlist",
    allow: ["10.0.0.0/8", "2001:db8::/32"],
  },
}
```

If no policy provider is available at run time the runner **fails
closed** to the most restrictive safe policy (egress denied, scratch
filesystem with read-only packages, privilege drop) rather than running
unsandboxed.

For the full layered model, the per-layer configuration reference, and
the cross-platform enforcement matrix, see the
[script sandbox developer reference](/checkstack/developer-guide/security/script-sandbox/).

## Working with existing checks

The shell collector was migrated from a `{ command, args }` shape to
a single `script` field at platform version 2. Existing checks are
auto-migrated on load - your old command + args are joined into one
script string with POSIX single-quote escaping, so the behaviour is
preserved verbatim. You can edit the resulting script to take
advantage of the new shell features (pipes, conditionals, ...) any
time.
