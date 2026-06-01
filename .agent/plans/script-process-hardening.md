# Script process hardening — OS-level isolation for the shared script runners

> **Status:** planned (design 2026-06-01, not started)
> **Branch:** off `main` (suggest `feat/script-process-hardening`)
> **Issue:** #247
> **Goal:** put a layered, opt-in OS-level sandbox around the two shared
> user-script executors (`shell-script-runner.ts`, `esm-script-runner.ts`) so
> that less-trusted authors can be contained: resource caps, filesystem
> confinement, network egress control, and privilege dropping — each layer
> independently toggleable, with capability detection and explicit graceful
> degradation, enforced uniformly on whichever core pod or remote satellite
> claims the job.

Self-contained handoff. Pick this up from this document alone. Every
current-state claim carries a verified `file:line` anchor. No feature code is
written here — this is the spec.

---

## 0. TL;DR for the implementer

1. The single chokepoint already exists: **every** user-script spawn in the
   platform goes through `defaultShellScriptRunner.run()` or
   `defaultEsmScriptRunner.run()` in `core/backend-api/src/`. Harden those two
   functions and all four call sites inherit it for free. Do NOT add isolation
   in the call sites.
2. Add ONE new module — `core/backend-api/src/script-sandbox/` — that owns: the
   zod `sandboxPolicySchema`, startup **capability detection**
   (`detectSandboxCapabilities()`), the **enforcement matrix** (which layers
   are honored on this host), and a `buildSpawnHardening(policy, caps)` that
   returns the extra `Bun.spawn` options (`uid`, `gid`, `argv0` wrapper,
   `env` overlay, rlimit prelude) plus an `effective` report. The two runners
   call it; nothing else changes shape.
3. Thread a single optional `sandbox?: SandboxPolicyInput` field through
   `ShellScriptRunOptions` and `EsmScriptRunOptions`, derived by the call sites
   from per-check / per-action config merged over a global default policy.
4. **Recommended defaults (justify in §6):** off-by-default opt-in for BETA;
   external-wrapper-first mechanism (`bwrap`/`nsjail` when present, native
   `setrlimit`+`uid/gid` always, namespaces only via the wrapper); IP/CIDR
   allowlist for v1 with link-local/metadata denied by default; per-layer
   `onUnavailable: "degrade" | "fail"` with `degrade` as the default and a
   surfaced downgrade signal.
5. Phases are independently shippable: §7. Each phase has its own test matrix.
6. Docs: rewrite the `script-health-checks.md` "Security model" section + add a
   new `developer-guide/security/script-sandbox.md`. Changeset = minor (beta),
   with a `### BREAKING` note only if a layer ever defaults to on.

---

## 1. Why

- **No OS-level sandbox today.** Both runtimes spawn child processes whose only
  containment is (a) the `SAFE_ENV_VARS` env whitelist and (b) a wall-clock
  timeout. A spawned script runs as the satellite/core process UID with full
  filesystem read/write, unrestricted outbound network, and no
  memory/CPU/PID/disk caps. The docs say so explicitly:
  `docs/src/content/docs/user-guide/reference/script-health-checks.md:227-242`
  ("Security model: ... There is **no sandbox** — `sh -c` runs as the satellite
  process's UID, and the inline-script subprocess inherits the same.").
- **Confirmed root cause = isolation never implemented, not a regression.**
  There are no `cgroup` / `chroot` / `rlimit` / `setrlimit` / `namespace` /
  `seccomp` / `uid:` / `gid:` references anywhere in either runner. The only
  resource control is the `setTimeout`-based race
  (`shell-script-runner.ts:119-125`, `esm-script-runner.ts:361-367`).
- **The blast radius is the whole pod / satellite.** A fork-bomb, an OOM, a
  disk-filler, or an exfil `fetch()` to the cloud metadata endpoint
  (`169.254.169.254`) all run with the host process's authority. The env
  scrubbing protects backend *secrets*, not the host.
- **A known env-injection escape exists.** The shell runner's `env` option is
  merged verbatim with user values winning on collision
  (`shell-script-runner.ts:135` — `env: { ...pickSafeEnv(), ...env }`), and the
  doc comment explicitly punts key validation to callers
  (`shell-script-runner.ts:49-60`). A caller-supplied `LD_PRELOAD` /
  `NODE_OPTIONS` / `PATH` override can subvert the child. This was flagged in
  prior analysis; the sandbox is the natural place to also enforce a forbidden
  env-key denylist centrally (§5.6).
- **Make the safe path the only path.** All four call sites already delegate to
  the two runners; isolation belongs there so no future call site can forget it.

---

## 2. Current state (verified anchors)

### 2.1 The two runners (the chokepoint)

**Shell runner — `core/backend-api/src/shell-script-runner.ts`:**

- `ShellScriptRunResult` — `:31-40` (`exitCode`, `stdout`, `stderr`, `timedOut`).
- `ShellScriptRunOptions` — `:42-61` (`script`, `timeoutMs`, `cwd?`, `env?`).
  The `env` doc comment explicitly says key validation is the caller's job
  (`:49-60`).
- `ShellScriptRunner` interface — `:68-70`.
- `SAFE_ENV_VARS` array — `:81-92` (`PATH`, `HOME`, `USER`, `LANG`, `LC_ALL`,
  `LC_CTYPE`, `TZ`, `TMPDIR`, `HOSTNAME`, `SHELL`).
- `pickSafeEnv()` — `:94-103`.
- `defaultShellScriptRunner.run()` — `:113-175`. The spawn is `:132-138`:
  `spawn({ cmd: ["sh", "-c", script], cwd, env: { ...pickSafeEnv(), ...env },
  stdout: "pipe", stderr: "pipe" })`. **No** `uid`/`gid`/rlimit/namespace. The
  timeout race is `:140-147`; cleanup `finally` is `:165-173`.

**ESM runner — `core/backend-api/src/esm-script-runner.ts`:**

- `EsmScriptRunResult` — `:51-64`.
- `EsmScriptRunOptions` — `:66-117` (`script`, `context`, `timeoutMs`,
  `helperModuleName?`, `helperFunctionName?`, `resolutionRoot?`, `env?`). The
  `resolutionRoot` doc (`:89-103`) and the secret-`env` doc (`:104-116`) are the
  precedent for adding one more optional field.
- `EsmScriptRunner` interface — `:124-126`.
- Duplicate `SAFE_ENV_VARS` + `pickSafeEnv()` — `:139-161` (identical to the
  shell runner — de-dup target, §5.6).
- `defaultEsmScriptRunner.run()` — `:325-518`. Per-run `mkdtemp` dir under
  `resolutionRoot ?? tmpdir()` (`:343-344`); writes `bunfig.toml` with
  `auto = "disable"` (`:393`), `user.mjs`, `runner.mjs`. The spawn is `:408-420`:
  `spawn({ cmd: [process.execPath, runnerPath], cwd: tmpDir, env:
  { ...pickSafeEnv(), ...injectedEnv }, stdout: "pipe", stderr: "pipe" })`.
  Timeout race `:425-444`; cleanup `finally` (clear timer → kill → `rm` tmpDir)
  `:501-516`.

Both are re-exported from `core/backend-api/src/index.ts:1-2`
(`export * from "./esm-script-runner"`, `export * from "./shell-script-runner"`).

### 2.2 The four call sites (inherit hardening for free)

1. **Inline TS health check** —
   `plugins/healthcheck-script-backend/src/inline-script-collector.ts`.
   `defaultInlineScriptExecutor.execute()` (`:80-108`) wraps
   `defaultEsmScriptRunner.run({...})` (`:89-105`), passing
   `helperModuleName: "@checkstack/healthcheck"`, optional `resolutionRoot`,
   optional secret `env`. The `InlineScriptExecutor` interface input already
   carries `runContext?`, `resolutionRoot?`, `secretEnv?` (`:61-72`) — the
   natural place to also accept the derived `sandbox` policy. The collector's
   `execute()` (`:295-400`) resolves `resolutionRoot`/`secretEnv` and calls the
   executor at `:330-337`.

2. **Shell health check** —
   `plugins/healthcheck-script-backend/src/strategy.ts`.
   `defaultScriptExecutor.execute()` (`:164-173`) calls
   `defaultShellScriptRunner.run({...})` (`:166-171`). The transport-client path
   is `createClient()` → `client.exec` (`:252-289`), which calls
   `this.executor.execute({ script, cwd, env, timeout })` at `:258-263`. (The
   issue's "around line 261" is this `exec` body.)

3. **`run_shell` automation action** —
   `plugins/integration-script-backend/src/automations.ts`.
   `createShellRunAction()` (`:148-263`); the runner call is
   `runner.run({ script, env: {...flattenScopeToShellEnv(scope), ...config.env,
   ...secretEnv}, cwd: config.workingDirectory, timeoutMs: config.timeout })` at
   `:183-196`. Note: this is the call site that layers operator `config.env`
   over the scope env — the env-denylist (§5.6) matters most here.

4. **`run_script` automation action** — same file.
   `createScriptRunAction()` (`:380-532`); the runner call is
   `runner.run({ script, context: scriptContext, timeoutMs: config.timeout,
   helperModuleName: "@checkstack/integration", ...env, ...resolutionRoot })` at
   `:441-450`.

All four already accept an injectable runner (`ScriptExecutor`,
`InlineScriptExecutor`, `ShellActionDeps.runner`, `ScriptActionDeps.runner`) for
test mocking — so the sandbox policy threads through their existing option
objects without touching the mock contract.

### 2.3 Config surfaces the policy will derive from

- Shell health-check config: `scriptConfigSchema = baseStrategyConfigSchema`
  (`strategy.ts:40`); `baseStrategyConfigSchema` is at
  `core/backend-api/src/base-strategy-config.ts:16-26`. Only `timeout` lives
  here today.
- Inline health-check config: `inlineScriptConfigSchema`
  (`inline-script-collector.ts:114-127`) — `script`, `secretEnv`, `timeout`.
- `run_shell` config: `shellRunConfigSchema`
  (`automations.ts:93-118`) — `script`, `env`, `secretEnv`, `workingDirectory`,
  `timeout` (`.min(1000).max(300_000)`).
- `run_script` config: `scriptRunConfigSchema`
  (`automations.ts:269-282`) — `script`, `secretEnv`, `timeout` via
  `requestTimeoutMs()` (`base-strategy-config.ts:43-46`,
  `.min(1000).max(60_000).default(10_000)`).
- `CollectorRunContext` — `core/backend-api/src/collector-strategy.ts:24-27`
  (metadata only; the sandbox policy must NOT live on the run context — it is
  policy, not run metadata; see §4.3).

### 2.4 Where it physically runs (scale note)

These spawns execute on **whichever core pod or remote satellite claims the
job** — health-check runs and automation action dispatch are queue-claimed, so
the same runner module runs on N pods and on detached satellites. The hardening
must therefore be self-contained inside the runner module (no shared mutable
process state, no "configure once on pod A" assumption). Capability detection is
**per-process** (cached at module init on each pod/satellite), and the
*effective* enforcement level can legitimately differ between a Linux pod and a
macOS satellite — that divergence MUST be surfaced per run (§5.7), never
silently assumed uniform. See `.agent/rules/state-and-scale.md`: there is no
shared current-state to read here, so the rule's three questions resolve as
"state is per-process capability detection, deterministic from the host kernel,
not duplicated" — call this out in the changeset.

---

## 3. Machinery to reuse (do NOT reinvent)

- **`Bun.spawn` options.** Bun's `spawn` already accepts `uid`, `gid`, and a
  custom `argv0`/wrapped `cmd`. Privilege dropping is `spawn({ ..., uid, gid })`
  (no syscall code). For rlimits and namespaces we wrap the command (§5).
- **The existing timeout + kill + cleanup pattern.** Keep it verbatim as the
  cross-platform backstop. The sandbox is *additive*; the timeout race
  (`shell-script-runner.ts:119-147`, `esm-script-runner.ts:361-444`) stays.
- **`SAFE_ENV_VARS` env scrubbing.** Unchanged in behavior; just de-duplicated
  into the new module and extended with a forbidden-key denylist (§5.6).
- **The `bunfig.toml auto = "disable"`** managed-package guard
  (`esm-script-runner.ts:393`) — orthogonal, leave it.
- **`requestTimeoutMs()` / `configNumber()` / `configString()` /
  `withConfigMeta()`** from `@checkstack/backend-api` for the new policy config
  fields (so the config UI renders them consistently).
- **zod 4** (repo is on zod 4 — see `automation-platform.md` watch-outs). All
  validation via zod per `.agent/rules/code-style-guide.md`.

---

## 4. Design: the layered sandbox

### 4.1 Where the new code lives

```
core/backend-api/src/script-sandbox/
├── index.ts                 # re-exports policy schema + types + the facade
├── policy.ts                # sandboxPolicySchema (zod) + defaults + merge
├── capabilities.ts          # detectSandboxCapabilities() (cached, per-process)
├── env-guard.ts             # SAFE_ENV_VARS (moved here) + forbidden-key denylist
├── wrapper.ts               # buildSpawnHardening() — argv wrapping + uid/gid + rlimit
├── network.ts               # egress allowlist → wrapper args / nft ruleset
└── report.ts                # EffectiveSandbox report shape + downgrade reasons
```

The two runner files import only `buildSpawnHardening`, `pickSafeEnv`
(re-exported from `env-guard`), and the policy types. Everything platform-specific
is centralized here so all four call sites inherit it.

### 4.2 The policy schema (exact zod, zod 4)

```ts
// core/backend-api/src/script-sandbox/policy.ts
import { z } from "zod";

/** What to do when a requested layer cannot be enforced on this host. */
export const onUnavailableSchema = z
  .enum(["degrade", "fail"])
  .describe(
    "degrade = drop this layer to the portable subset and surface a downgrade; " +
      "fail = refuse to run when the layer can't be enforced.",
  );

/** Per-run resource caps. All optional; unset = not capped by this layer. */
export const resourceLimitsSchema = z.object({
  cpuSeconds: z.number().int().positive().max(3600).optional()
    .describe("Max CPU time (RLIMIT_CPU). Distinct from the wall-clock timeout."),
  memoryBytes: z.number().int().positive().optional()
    .describe("Max address space (RLIMIT_AS). On the ESM runner also derives --smol / --max-old-space-size as the portable fallback."),
  maxOpenFiles: z.number().int().positive().max(1_048_576).optional()
    .describe("Max open file descriptors (RLIMIT_NOFILE)."),
  maxProcesses: z.number().int().positive().max(65_536).optional()
    .describe("Max processes/threads for the run's UID (RLIMIT_NPROC). Fork-bomb guard."),
  maxOutputBytes: z.number().int().positive().optional()
    .describe("Hard cap on captured stdout+stderr; the runner truncates and flags overflow."),
  maxFileSizeBytes: z.number().int().positive().optional()
    .describe("Max single-file write size (RLIMIT_FSIZE). Disk-filler guard."),
}).strict();

export const filesystemPolicySchema = z.object({
  mode: z.enum(["off", "scratch-only", "scratch-plus-ro"]).default("off")
    .describe(
      "off = current behavior (full host FS). " +
        "scratch-only = child sees only its per-run scratch dir (writable) + a minimal /usr,/bin,/lib read-only. " +
        "scratch-plus-ro = scratch-only PLUS a read-only bind of resolutionRoot/node_modules for managed packages.",
    ),
  scratchBytes: z.number().int().positive().optional()
    .describe("Optional tmpfs size cap for the scratch dir when the mechanism supports it."),
}).strict();

export const networkPolicySchema = z.object({
  mode: z.enum(["unrestricted", "deny", "allowlist"]).default("unrestricted")
    .describe(
      "unrestricted = current behavior. " +
        "deny = no egress (loopback only). " +
        "allowlist = only the listed destinations are reachable.",
    ),
  /** v1: IP / CIDR only (see §6 decision). Domains are a v2 extension. */
  allow: z.array(z.string()).default([])
    .describe("IPv4/IPv6 addresses or CIDR blocks reachable when mode=allowlist."),
  denyLinkLocalAndMetadata: z.boolean().default(true)
    .describe("Always block 169.254.0.0/16, fc00::/7 link-local, and cloud metadata IPs, even under unrestricted, when a network layer is active."),
}).strict();

export const privilegePolicySchema = z.object({
  mode: z.enum(["inherit", "drop-to-uid"]).default("inherit")
    .describe("inherit = run as the host process UID (current). drop-to-uid = run as the configured low-priv UID/GID."),
  uid: z.number().int().nonnegative().optional(),
  gid: z.number().int().nonnegative().optional(),
}).strict();

export const sandboxPolicySchema = z.object({
  /** Master switch. When false the runner behaves exactly as today. */
  enabled: z.boolean().default(false),
  onUnavailable: onUnavailableSchema.default("degrade"),
  resources: resourceLimitsSchema.default({}),
  filesystem: filesystemPolicySchema.default({}),
  network: networkPolicySchema.default({}),
  privilege: privilegePolicySchema.default({}),
}).strict();

export type SandboxPolicy = z.infer<typeof sandboxPolicySchema>;
export type SandboxPolicyInput = z.input<typeof sandboxPolicySchema>;
```

> A `drop-to-uid` privilege mode plus `cpuSeconds`/`maxProcesses` is what makes
> a low-trust author safe; `network.mode` is the exfil control;
> `filesystem.mode` is the host-read control. They are independent knobs.

### 4.3 How it threads through the runner options

Add ONE optional field to each runner's option interface (mirroring how
`resolutionRoot`/`env` were added — `esm-script-runner.ts:89-116`):

```ts
// ShellScriptRunOptions (shell-script-runner.ts:42) and
// EsmScriptRunOptions (esm-script-runner.ts:66) each gain:
  /**
   * OS-level hardening policy for this run. Validated + reconciled against
   * detected host capabilities by the shared script-sandbox module. When
   * omitted (or { enabled:false }), the runner behaves exactly as before.
   */
  sandbox?: SandboxPolicyInput;
```

The runner body, just before `spawn(...)`:

```ts
const caps = detectSandboxCapabilities();               // cached per-process
const policy = sandboxPolicySchema.parse(sandbox ?? {});
const hardening = buildSpawnHardening({ policy, caps, scratchDir: tmpDir /* esm */ });
// hardening.effective is attached to the result for surfacing (§5.7)
proc = spawn({
  cmd: hardening.wrapCmd(["sh", "-c", script]),         // or [bun, runnerPath]
  cwd,
  env: hardening.env(pickSafeEnv(), env),               // overlay + denylist
  ...(hardening.uid !== undefined ? { uid: hardening.uid } : {}),
  ...(hardening.gid !== undefined ? { gid: hardening.gid } : {}),
  stdout: "pipe",
  stderr: "pipe",
});
```

`buildSpawnHardening` is pure & synchronous (capability detection is cached), so
neither runner gains an `await` before spawn. If `policy.onUnavailable === "fail"`
and a requested layer is unavailable, `buildSpawnHardening` throws a typed
`SandboxUnavailableError` BEFORE spawn — the runner catches it and returns a
clean failure result (`exitCode:-1` / `error:"sandbox unavailable: ..."`), never
spawning an unsandboxed child.

**Where the policy comes from (call sites):** each call site computes
`sandbox` = `mergeSandboxPolicy(globalDefault, perItemOverride)` and passes it
through its existing executor option object. The global default is read from a
platform setting (see §5.8); the per-item override comes from a new optional
`sandbox` block on each config schema (§4.4). The sandbox policy deliberately
does NOT travel on `CollectorRunContext` (`collector-strategy.ts:24-27`) — that
type is curated run *metadata*, not authority config.

### 4.4 Config schema additions (per call site)

A single reusable `sandboxConfigField()` (in `@checkstack/backend-api`, built
from `sandboxPolicySchema` + `withConfigMeta`) is `.optional()`-added to all
four config schemas:

- `baseStrategyConfigSchema` (`base-strategy-config.ts:16`) → covers the shell
  health check (and any future base-config strategy).
- `inlineScriptConfigSchema` (`inline-script-collector.ts:114`).
- `shellRunConfigSchema` (`automations.ts:93`).
- `scriptRunConfigSchema` (`automations.ts:269`).

Because all four already version their config via `Versioned`, the addition is a
backward-compatible optional field — no migration needed (absent = inherit
global default).

---

## 5. The four layers + cross-platform enforcement

### 5.1 Layer 1 — resource limits

| Cap | Linux primitive | macOS / portable fallback |
| --- | --- | --- |
| CPU time | `prlimit`/`setrlimit RLIMIT_CPU` (via wrapper) | wall-clock timeout only (already present) |
| Memory | `RLIMIT_AS` (wrapper) or cgroup v2 `memory.max` | ESM: `--smol` + `NODE_OPTIONS=--max-old-space-size`; shell: none |
| Open files | `RLIMIT_NOFILE` | none (timeout backstop) |
| PIDs/threads | `RLIMIT_NPROC` or cgroup `pids.max` | none |
| Output bytes | runner-side truncation of captured stdout/stderr | **same on every platform** (pure JS in the runner) |
| File size | `RLIMIT_FSIZE` | none |

Implementation: when a Linux `prlimit` (`util-linux`) or a wrappable cgroup
slice is available, `wrapCmd` prepends a tiny POSIX wrapper that calls the
limit-setting tool then `exec`s the real command (e.g.
`["prlimit", "--cpu=…", "--as=…", "--nofile=…", "--nproc=…", "--", ...cmd]`, or a
`bwrap`/`nsjail` `--rlimit-*` flag set). `maxOutputBytes` is enforced
purely in the runner by counting bytes off the stdout/stderr streams and killing
+ flagging `outputTruncated` once exceeded (works everywhere).

### 5.2 Layer 2 — filesystem isolation

- **`scratch-only` / `scratch-plus-ro`** are honored only through a
  namespace-capable wrapper (`bwrap --unshare-all --ro-bind /usr /usr
  --bind <scratch> <scratch> [--ro-bind <root>/node_modules ...]`, or the
  `nsjail` equivalent). For the ESM runner the scratch dir is the existing
  per-run `mkdtemp` dir (`esm-script-runner.ts:343-344`) and the `node_modules`
  RO bind is `<resolutionRoot>/node_modules` (`esm-script-runner.ts:91-103`).
- No wrapper present → cannot confine the FS. `degrade` drops to `off` and
  surfaces it; `fail` refuses.
- Raw `chroot`/`pivot_root` is explicitly **out of scope** for v1 (needs
  CAP_SYS_ADMIN / root; the wrapper-first decision in §6 covers it via unpriv
  user namespaces).

### 5.3 Layer 3 — network egress control

- **v1 = IP/CIDR allowlist + `deny`** (decision §6). Mechanism: the namespace
  wrapper creates a network namespace; egress is filtered by an `nft`/`iptables`
  ruleset (or the wrapper's built-in `--` net flags) that allows only the listed
  CIDRs and the loopback, and that **always** rejects `169.254.169.254`,
  `169.254.0.0/16`, `fd00:ec2::254`, and link-local `fe80::/10` /
  `fc00::/7` when `denyLinkLocalAndMetadata` (default true).
- `mode: "deny"` = drop the child into an isolated net namespace with loopback
  only — covers both `fetch` and raw sockets because it is enforced at the
  kernel, not the language runtime.
- **Domain allowlisting is v2** (DNS-resolution race; see §6). For v1 an
  operator who needs `api.example.com` resolves it themselves and lists the
  resulting CIDR, OR runs a sidecar egress proxy and allowlists its IP.
- No net-namespace capability → `degrade` drops network control to
  `unrestricted` and surfaces it (the metadata-IP block also cannot be enforced
  without the namespace; that downgrade is part of the surfaced report);
  `fail` refuses.

### 5.4 Layer 4 — privilege dropping

- `drop-to-uid` → pass `uid`/`gid` straight to `Bun.spawn` (no wrapper needed).
  Requires the host process to have the privilege to setuid (typically running
  as root or with CAP_SETUID). Capability detection probes
  `process.getuid?.() === 0` (or a successful no-op `setgid` dry-run is NOT
  attempted — too risky; we detect by euid only and treat non-root as "cannot
  drop").
- `inherit` = today's behavior.
- No privilege to drop → `degrade` keeps `inherit` + surfaces; `fail` refuses.

### 5.5 Capability detection + the enforcement matrix

`detectSandboxCapabilities()` (cached per-process; pure reads, no spawning of
probes beyond `which`-style binary existence checks done once) returns:

```ts
interface SandboxCapabilities {
  platform: "linux" | "darwin" | "other";
  euidIsRoot: boolean;                 // can we drop privilege?
  hasPrlimit: boolean;                 // util-linux prlimit on PATH
  rlimitNative: boolean;               // can we set rlimits without a wrapper
  wrapper: "bwrap" | "nsjail" | "firejail" | null; // first found on PATH
  userNamespaces: boolean;             // /proc/sys/kernel/unprivileged_userns_clone or kernel >= supports
  netNamespaces: boolean;              // implied by wrapper + userns
  cgroupV2Delegated: boolean;          // a writable cgroup.subtree we may use
}
```

The **enforcement matrix** (what each layer maps to given capabilities):

| Layer | Linux + wrapper + userns | Linux, no wrapper | macOS / restricted container |
| --- | --- | --- | --- |
| Resource caps | full (rlimit/cgroup) | rlimit via `prlimit` if present, else portable subset | portable subset (timeout, ESM mem flags, output truncation) |
| Filesystem | full (`scratch-only`/`-plus-ro`) | none → degrade/fail | none → degrade/fail |
| Network | full (allowlist/deny + metadata block) | none → degrade/fail | none → degrade/fail |
| Privilege | `uid`/`gid` if euid root | `uid`/`gid` if euid root | `uid`/`gid` if euid root |

### 5.6 Env hardening (centralized)

- Move `SAFE_ENV_VARS` + `pickSafeEnv()` into `script-sandbox/env-guard.ts`
  (de-dups the two identical copies — `shell-script-runner.ts:81-103`,
  `esm-script-runner.ts:139-161`). Re-export so existing imports keep working.
- Add a **forbidden-key denylist** applied to the merged env (closes the
  `LD_PRELOAD`/`NODE_OPTIONS`/`PATH`-override escape, esp. relevant at
  `automations.ts:189-193` where operator `config.env` is layered over scope):
  `LD_PRELOAD`, `LD_LIBRARY_PATH`, `LD_AUDIT`, `DYLD_INSERT_LIBRARIES`,
  `DYLD_LIBRARY_PATH`, `NODE_OPTIONS`, `BUN_INSTALL`, `BUN_CONFIG_*`. When the
  sandbox is enabled, a user/operator attempt to set these is dropped and
  recorded in the effective report; when disabled, behavior is unchanged
  (back-compat) — so this only tightens for opted-in runs.

### 5.7 Graceful degradation + surfacing (no silent pretense)

`EeffectiveSandbox` is attached to BOTH run results
(`ShellScriptRunResult`, `EsmScriptRunResult` each gain
`sandbox?: EffectiveSandbox`):

```ts
interface EffectiveSandbox {
  requested: SandboxPolicy;
  enforced: { resources: boolean; filesystem: boolean; network: boolean; privilege: boolean };
  downgrades: Array<{ layer: string; reason: string }>; // empty when fully enforced
  platform: string;
}
```

- Call sites log a single structured warning per run when `downgrades` is
  non-empty (e.g. `logger.warn("sandbox degraded: network not enforced (no net
  namespace capability)")`) and may surface it in the run record.
- A startup log line per pod/satellite emits the detected capabilities + the
  effective level for the configured global default, so operators see what their
  host actually enforces (issue requirement: "expose the effective hardening
  level").

### 5.8 Global default policy source

A platform-level setting holds the global default `SandboxPolicy`. **It is NOT
pod-local state** — it is read from the same durable settings mechanism existing
platform settings use (verify the concrete table/service before Phase 1; do not
introduce a new store if one already holds platform settings). Per
`.agent/rules/state-and-scale.md` Q2: the default must read identically on every
pod, so it lives in shared/durable storage, not an env var that could differ
per pod. (A bootstrap env var MAY seed the initial value, but the runtime read
is from durable settings.) Flag for user: confirm which existing settings
surface to attach this to.

---

## 6. Open questions — recommended decisions

### D1 — Default posture: **off-by-default opt-in (recommend), needs sign-off**

Ship `enabled: false` as the schema default. Rationale: the platform is in
**BETA** and the strong layers are Linux-and-capability dependent; turning
hardening on by default would (a) silently change child behavior for every
existing install on upgrade, (b) break legitimate scripts that read host files
or call out to internal services, and (c) on macOS/dev or a restricted container
either fail-closed (breakage) or degrade to near-nothing (false sense of
security). Off-by-default means zero upgrade surprise; operators opt in per
deployment / per check once they understand their host's enforcement matrix. A
single documented switch (`sandbox.enabled: true` at the global default) flips it
on cluster-wide. **User must approve** — this is the one decision that changes
upgrade behavior; the alternative (on-by-default with opt-out for trusted
single-tenant) is defensible only once the enforcement matrix is mature, which
argues for revisiting at GA, not in BETA.

### D2 — Mechanism boundary: **external-wrapper-first (recommend)**

Native always for the cheap, dependency-free wins: `uid`/`gid` via `Bun.spawn`,
`RLIMIT_*` via `prlimit` when present, and output truncation in pure JS.
**Namespaces (filesystem + network) are delegated to an external wrapper**
(`bwrap` → `nsjail` → `firejail`, first found) rather than hand-rolling
`clone(CLONE_NEW*)` + `nftables` syscall code. Rationale: unprivileged user
namespaces + mount + net namespaces are notoriously fiddly and security-critical;
`bubblewrap` is a small, audited, widely-packaged setuid-free tool built exactly
for this and is what Flatpak/CI sandboxes use. Re-implementing it natively is a
large, high-risk surface for a BETA feature. Absence of any wrapper → "portable
subset only" for the FS/net layers (degrade or fail per `onUnavailable`). This
keeps the native footprint tiny while still allowing strong isolation where a
wrapper is installed. No sign-off needed (reversible — native syscalls can be
added later behind the same `capabilities` abstraction).

### D3 — Network allowlist granularity: **IP/CIDR for v1 (recommend)**

v1 enforces IP/CIDR allowlist + full `deny`, plus the always-on link-local /
metadata block. Domain-based allowlisting is **deferred to v2**. Rationale:
kernel-level net-namespace filtering operates on packets/IPs; domain
allowlisting requires either an in-namespace DNS-aware proxy or live
resolve-then-pin with an inherent TOCTOU race (resolve to an allowed IP, then
the script connects to a different IP). That is a meaningful design effort and a
genuine security footgun if done naively. IP/CIDR is unambiguous, race-free, and
covers the highest-value case (block exfil / metadata, allow a known internal
range). Operators needing domains run an egress proxy and allowlist its IP. No
sign-off needed; note the v1 limitation in docs.

### D4 — Fail-open vs fail-closed: **per-layer, default `degrade` (recommend)**

`onUnavailable` is a policy field, defaulting to `degrade` (fail-open to the
portable subset) with `fail` (fail-closed) available. Rationale: a hard global
fail-closed default would make the very-common case (a macOS dev satellite, a
container without userns) refuse to run any script the moment hardening is
enabled — terrible ergonomics that pushes operators to disable hardening
entirely. `degrade` keeps scripts running while **loudly surfacing** every
downgrade (§5.7), so there is no silent pretense — the operator sees exactly
what is/ isn't enforced and can switch a sensitive check to `fail` deliberately.
This pairs with D1: off-by-default + degrade-on-opt-in is the least-surprising
combination. No sign-off needed, but the "degrade surfaces, never hides"
guarantee is a hard requirement, not a nicety.

> **Summary of sign-off asks:** only **D1** (default posture) strictly needs
> user approval before Phase 1. D2/D3/D4 are recommended and reversible; confirm
> the §5.8 settings-surface attachment when reached.

---

## 7. Phased breakdown (each shippable)

Each phase is an independent PR. Phase 1 ships value (resource caps + privilege
drop + env denylist) with zero new external dependency.

### Phase 1 — Scaffold + portable resource caps + privilege drop + env denylist

- New `script-sandbox/` module: `policy.ts`, `capabilities.ts`, `env-guard.ts`
  (move `SAFE_ENV_VARS` here), `report.ts`, `wrapper.ts` (uid/gid + `prlimit`
  prelude + output-truncation hook only — no namespaces yet).
- Add `sandbox?` to both runner option interfaces; wire `buildSpawnHardening`
  into both `spawn` calls; attach `EffectiveSandbox` to both results.
- Add `sandboxConfigField()` to the four config schemas; call sites derive +
  merge global default with per-item override.
- Forbidden-env-key denylist active when enabled.
- **Milestone:** on a root Linux host, a check can be capped (CPU/mem/PID/files)
  and dropped to a low-priv UID; output truncation + the env denylist work
  everywhere.

### Phase 2 — Wrapper detection + filesystem isolation

- `capabilities.ts` detects `bwrap`/`nsjail`/`firejail` + userns; `wrapper.ts`
  builds the FS-confinement argv (`scratch-only`, `scratch-plus-ro`).
- ESM runner passes its `mkdtemp` dir as scratch and `resolutionRoot/node_modules`
  as the RO bind.
- **Milestone:** with `bwrap` installed, a script can no longer read arbitrary
  host files; managed-package imports still resolve under `scratch-plus-ro`.

### Phase 3 — Network egress control

- `network.ts` builds net-namespace + IP/CIDR allowlist / `deny` rules and the
  always-on metadata/link-local block.
- **Milestone:** a `deny` script cannot reach the network; an `allowlist`
  script reaches only listed CIDRs; metadata IP blocked.

### Phase 4 — Operator surface + docs + observability

- Global-default settings surface (§5.8); per-run downgrade surfacing in run
  records; startup capability log line.
- Full docs (§9). Changeset.
- **Milestone:** operators can see and configure the effective sandbox; the
  "no sandbox" doc section is gone.

---

## 8. Per-phase test matrix

All tests use **bun's test runner** (`.agent/rules/testing.md`). Unit/fakes by
default; the genuinely-OS-dependent assertions are env-gated integration tests
(skip with a clear message when the capability is absent — never silently pass).

**Phase 1**
- `policy.test.ts`: schema parse/defaults/`.strict()` rejects unknown keys;
  `mergeSandboxPolicy` precedence (per-item over global).
- `env-guard.test.ts`: denylist drops `LD_PRELOAD`/`NODE_OPTIONS`/`PATH` override
  when enabled; passes them through when disabled (back-compat); `pickSafeEnv`
  unchanged. Regression for the known env-injection escape (§1).
- `capabilities.test.ts`: deterministic shape on the current host; `euidIsRoot`
  reflects `process.getuid`.
- `wrapper.test.ts`: `buildSpawnHardening` returns correct `uid`/`gid` and
  `prlimit` argv for given policy+caps; `onUnavailable:"fail"` throws
  `SandboxUnavailableError`; `degrade` returns a report with the downgrade.
- Runner unit tests with a fake: existing shell/inline tests still green; a new
  test asserts `result.sandbox.enforced`/`downgrades` are populated.
- Existing `security.test.ts` (`plugins/healthcheck-script-backend/src/security.test.ts:1-23`)
  must stay green (env-leak guarantee unchanged).
- Integration (env-gated, root Linux): CPU/mem/PID caps actually trigger
  (fork-bomb killed, `:(){ :|:& };:` contained; `dd`-style mem alloc OOM-killed
  within the cap, not the pod).

**Phase 2**
- Unit: `wrapper.ts` emits the right `bwrap` argv for each `filesystem.mode`.
- Integration (env-gated, `bwrap` present): script reading `/etc/shadow` fails;
  managed-package import under `scratch-plus-ro` succeeds; no-wrapper host →
  degrade report (and `fail` refuses).

**Phase 3**
- Unit: `network.ts` rule generation for `deny` / `allowlist` / metadata block.
- Integration (env-gated, netns capable): `deny` → `fetch` fails; `allowlist`
  → only listed CIDR reachable; `169.254.169.254` always refused.

**Phase 4**
- Global-default settings read returns identical value on a simulated second
  process (scale-correctness guard per `.agent/rules/state-and-scale.md`).
- Downgrade surfaced in the run record; startup capability log asserted.

---

## 9. Docs deliverables (same PR per `.agent/rules/architecture.md`)

1. **Rewrite the "Security model" section** of
   `docs/src/content/docs/user-guide/reference/script-health-checks.md:227-242`.
   Remove the "There is **no sandbox**" framing; replace with: the layers, the
   off-by-default posture, how to enable, the cross-platform enforcement matrix,
   and the "degrade surfaces, never hides" guarantee. Keep the existing env /
   concurrency sections.
2. **New page** `docs/src/content/docs/developer-guide/security/script-sandbox.md`
   (the `developer-guide/security/` dir already exists —
   `auth-error-handling.md`, `custom-auth-plugins.md`). Reference page:
   frontmatter `title:` + `description:`; the canonical `sandboxPolicySchema`
   snippet; the enforcement matrix table; capability detection + degradation;
   the v1 IP/CIDR-only network note; how to install `bwrap` for full isolation;
   the env denylist. Sentence-case headings, no in-body H1, no em-dashes,
   present-tense impersonal, at least one runnable config example
   (`.agent/rules/docs-style.md`).
3. Cross-link both pages (slug-based, `/checkstack/...`).

---

## 10. Changeset + scale note

- **Changeset (required):** minor bump (BETA policy — never major) for
  `@checkstack/backend-api`, `@checkstack/healthcheck-script-backend`,
  `@checkstack/integration-script-backend`. Summary: "Add an opt-in, layered
  OS-level sandbox (resource limits, filesystem isolation, network egress
  control, privilege dropping) around the shared script runners, off by default
  with capability detection and surfaced graceful degradation." Add a
  `### BREAKING` note ONLY if D1 is later flipped to on-by-default.
- **Scale note (put in the changeset + PR per `.agent/rules/state-and-scale.md`):**
  (1) State lives per-process (cached capability detection, deterministic from
  the host kernel) plus one durable global-default policy in shared settings.
  (2) The global default reads identically on every pod (durable settings, not
  pod-local). (3) Capability detection is intentionally per-host and may differ
  between a Linux pod and a macOS satellite — this divergence is **surfaced per
  run** (§5.7), never assumed uniform. Hardening is enforced wherever the runner
  module executes (whichever pod/satellite claims the job), because it lives
  inside the shared runner, not a call site.

---

## 11. Watch-outs / non-obvious things

- **No `any`, no `as`** (`.agent/rules/code-style-guide.md`). The wrapper argv
  builder and capability probes are easy to get lazy with — model the shapes.
- **All validation via zod** — the policy schema is the single source of truth;
  do not parse config by hand.
- **Don't touch `CollectorRunContext`** — policy is authority, not run metadata.
- **Keep the timeout + kill + cleanup verbatim** — the sandbox is additive; a
  regression there reintroduces the runaway-process bug the runners already fix
  (`esm-script-runner.ts:501-516`).
- **`bunfig.toml auto = "disable"`** must survive FS confinement — under
  `scratch-plus-ro` the per-run dir (which contains `bunfig.toml`) must stay the
  cwd and be a writable bind, or Bun won't read it.
- **Capability detection must not spawn per-run** — cache it at module init; a
  per-run `which bwrap` would tax every health check.
- **`onUnavailable:"fail"` must fail BEFORE spawn** — never spawn an unsandboxed
  child and then notice the layer was unavailable.
- **`typecheck:references:generate`** is only needed if you add a new
  `@checkstack/*` dependency; this plan keeps everything inside `backend-api`,
  so likely no reference change — but run it if you add a dep
  (`.agent/rules/typecheck.md`).
- **Run `bun run typecheck` + `bun run lint` + `bun test`** for touched files
  before declaring any phase done; fix causes, never disable rules
  (`~/.claude/CLAUDE.md`).
- **Ask before committing.** Conventional Commits (`feat:`).

---

## 12. How to pick this up cleanly

1. Read this file top to bottom — all context is here.
2. Confirm **D1 (default posture)** with the user and the §5.8 settings-surface
   attachment.
3. Start Phase 1 (no new external dep, ships value): scaffold `script-sandbox/`,
   move `SAFE_ENV_VARS`, wire `buildSpawnHardening` into both runners, add the
   config field + call-site merge.
4. Commit per phase; each phase is a clean PR boundary.
5. When in doubt, mirror the existing runner option/threading pattern
   (`esm-script-runner.ts:89-116` for how `resolutionRoot`/`env` were added),
   not a new convention.

---

*Last updated: 2026-06-01. Plan only; no code written. Load-bearing constraints
(single chokepoint at the two runners, capability-dependent enforcement, per-host
divergence surfaced not assumed, BETA off-by-default) are documented above;
decisions D1–D4 are recommended with D1 flagged for user sign-off.*
