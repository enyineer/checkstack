# Script process hardening — OS-level isolation for the shared script runners

> **Status:** planned (design 2026-06-01, not started)
> **Branch:** off `main` (suggest `feat/script-process-hardening`)
> **Issue:** #247
> **Goal:** put a layered, **on-by-default (opt-out)** OS-level sandbox around
> the two shared user-script executors (`shell-script-runner.ts`,
> `esm-script-runner.ts`) so that less-trusted authors are contained out of the
> box: resource caps, filesystem confinement, network egress control, and
> privilege dropping — each layer independently toggleable, with capability
> detection and explicit graceful degradation, enforced uniformly on whichever
> core pod or remote satellite claims the job. A permissive **default profile**
> (§6.1) keeps common existing scripts working on upgrade; hosts lacking the
> strong primitives degrade-and-surface to the portable subset (never
> hard-break).

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
4. **Locked decisions (justify in §6):** **on-by-default with opt-out** (D1,
   LOCKED by the maintainer) shipping the permissive **default profile** in
   §6.1 so common existing scripts keep working on upgrade; external-wrapper-first
   mechanism (`bwrap`/`nsjail` when present, native `setrlimit`+`uid/gid`
   always, namespaces only via the wrapper); IP/CIDR allowlist for v1 with
   link-local/metadata denied by default; per-layer
   `onUnavailable: "degrade" | "fail"` with `degrade` as the global default and
   a surfaced downgrade signal — so on-by-default cannot hard-break hosts
   lacking the strong primitives.
5. Phases are independently shippable: §7. Each phase has its own test matrix
   (incl. an upgrade-compat / default-profile row and a degraded-host row).
6. Docs: rewrite the `script-health-checks.md` "Security model" section + add a
   new `developer-guide/security/script-sandbox.md`. Changeset = **minor (beta)
   with a `### BREAKING` note** — hardening is now enforced by default; document
   what the default profile allows/blocks and the per-check + global opt-out.

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
  /**
   * Master switch. Schema default is TRUE (D1: on-by-default with opt-out).
   * Set `enabled: false` to restore the pre-hardening behavior (the documented
   * opt-out). The GLOBAL default policy that the runner actually parses against
   * is the permissive DEFAULT PROFILE in §6.1, not the bare per-field zod
   * defaults below — the field defaults stay conservative so an explicit
   * partial override (e.g. just `{ network: { mode: "deny" } }`) doesn't
   * accidentally widen the other layers.
   */
  enabled: z.boolean().default(true),
  onUnavailable: onUnavailableSchema.default("degrade"),
  resources: resourceLimitsSchema.default({}),
  filesystem: filesystemPolicySchema.default({}),
  network: networkPolicySchema.default({}),
  privilege: privilegePolicySchema.default({}),
}).strict();

export type SandboxPolicy = z.infer<typeof sandboxPolicySchema>;
export type SandboxPolicyInput = z.input<typeof sandboxPolicySchema>;
```

> **Field defaults vs. the shipped default profile.** The bare zod field
> defaults above are deliberately *minimal* (`filesystem.off`,
> `network.unrestricted` modulo the metadata block, `privilege.inherit`, no
> resource caps) so that `mergeSandboxPolicy(globalDefault, partialOverride)`
> never silently re-widens a layer the operator didn't touch. The actual
> shipped GLOBAL default — what an install gets on upgrade with no config — is
> the **permissive default profile (DP)** defined in §6.1: it sets concrete
> resource caps, `filesystem: scratch-plus-ro`, `network: unrestricted` with
> the metadata/link-local block on, and `privilege: drop-to-uid` when a UID is
> available. DP is the value `mergeSandboxPolicy` starts from; per-item config
> overrides individual fields on top.

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

## 6. Decisions (LOCKED) + the upgrade-safety story

### D1 — Default posture: **on-by-default with opt-out (LOCKED by maintainer)**

Ship the sandbox **enabled by default** (`enabled: true`), applying the
permissive **default profile (DP)** in §6.1, with a documented opt-out at two
granularities:

- **Global opt-out:** set the global default policy to `{ enabled: false }`
  (the §5.8 settings surface) — restores the exact pre-hardening behavior
  cluster-wide for a trusted single-tenant deployment.
- **Per-check / per-action opt-out:** the `sandbox` config field (§4.4) can set
  `enabled: false` (or loosen individual layers) on one check/action while the
  rest of the install stays hardened.

Rationale for on-by-default being safe despite BETA:

1. **The default profile is permissive** (§6.1): it allows ordinary outbound
   `fetch` to external APIs, temp-file writes in the per-run scratch dir, and
   generous CPU/mem — so the *common* existing script keeps working untouched.
   It blocks only the genuinely-dangerous defaults (fork-bombs, OOM, disk-fill,
   metadata/link-local exfil, reading arbitrary host files).
2. **Degraded hosts cannot hard-break** (§6.2): the global `onUnavailable`
   default is `degrade`, so a macOS dev satellite or a container without
   userns/wrapper silently falls back to the portable subset (timeout + ESM
   memory flags + output truncation + env denylist) and *surfaces* that, rather
   than refusing to run. On-by-default therefore never turns a working install
   into a non-working one.
3. **Secure-by-default is the right BETA posture.** Off-by-default would ship a
   security feature that the vast majority of installs never turn on, leaving
   the documented "no sandbox" hole open in practice. Flipping the default later
   (off → on) would itself be the disruptive change; doing it now, while the
   surface is small and the default profile is tuned to be non-breaking, is the
   least-disruptive moment.

The cost is a real but bounded behavior change on upgrade — captured in the
upgrade notes (§6.3) and the `### BREAKING` changeset note (§10). This decision
is **LOCKED**; no sign-off pending. (Only the §5.8 settings-surface attachment
still needs confirmation when reached.)

### D1.1 (§6.1) — The default profile (DP), concrete values

DP is the shipped global default policy. It is permissive-but-safe: tuned so a
typical existing health check (curl an API, write a temp file, do light
computation) runs unchanged, while the abuse cases are capped.

```ts
// The shipped global default. Concrete, not the bare zod field defaults.
export const DEFAULT_SANDBOX_PROFILE: SandboxPolicy = {
  enabled: true,
  onUnavailable: "degrade",            // never hard-break a degraded host
  resources: {
    cpuSeconds: 60,                    // generous vs. the wall-clock timeout
    memoryBytes: 512 * 1024 * 1024,    // 512 MiB address space
    maxOpenFiles: 1024,                // plenty for fetch + a few files
    maxProcesses: 256,                 // fork-bomb guard, not a real-work limit
    maxOutputBytes: 5 * 1024 * 1024,   // 5 MiB captured stdout+stderr, then truncate+flag
    maxFileSizeBytes: 256 * 1024 * 1024, // 256 MiB single-file write, disk-fill guard
  },
  filesystem: {
    mode: "scratch-plus-ro",           // writable scratch + RO node_modules; host FS hidden
    // scratchBytes left unset -> mechanism default
  },
  network: {
    mode: "unrestricted",              // outbound fetch to external APIs KEEPS WORKING
    allow: [],
    denyLinkLocalAndMetadata: true,    // block 169.254.0.0/16 + cloud metadata + link-local
  },
  privilege: {
    mode: "drop-to-uid",               // drop to the dedicated low-priv UID WHEN available
    // uid/gid resolved from config/env at startup; absent -> degrades to inherit
  },
};
```

Why these specifics keep common scripts working:

- **Network `unrestricted` (not `deny`).** The single most common thing a check
  does is call an external HTTP API. Defaulting to `deny` would break the
  majority of real checks on upgrade. DP keeps egress open but adds the
  always-on metadata/link-local block — which legitimate checks never rely on —
  so SSRF-to-metadata exfil is closed without touching ordinary API calls.
  Operators who want tighter control opt into `deny`/`allowlist` per check.
- **`filesystem: scratch-plus-ro`.** Temp-file writes (the common case) land in
  the per-run scratch dir, which is writable; `import` of managed packages
  still resolves via the RO `node_modules` bind. Only reads of *arbitrary host
  paths* break — which is exactly the behavior on-by-default intends to stop,
  and which is rare in legitimate checks. On a host without a namespace wrapper
  this layer degrades to `off` (full host FS, as today) and surfaces it, so
  upgrade can't break it there at all.
- **Resource caps sized for headroom, not as work limits.** 60 CPU-seconds,
  512 MiB, 256 PIDs, 1024 FDs are well above what a normal check uses but below
  fork-bomb/OOM territory. A script that legitimately needs more sets a per-item
  override.
- **`privilege: drop-to-uid` only when a UID is configured/available.** If the
  host process isn't privileged to setuid (the common dev/macOS case), this
  degrades to `inherit` and surfaces it — no breakage.

### D1.2 (§6.2) — Behavior on hosts lacking the strong primitives

On non-Linux (macOS), or a restricted container without unprivileged user
namespaces / no `bwrap`/`nsjail` / no `prlimit` / non-root euid, the **default
`onUnavailable: "degrade"`** means each unavailable layer falls back to the
**portable subset** and is recorded in the surfaced report (§5.7):

| Layer | Portable-subset fallback on a degraded host |
| --- | --- |
| Resources | wall-clock timeout (already present) + ESM `--smol`/`--max-old-space-size` + runner-side output truncation; rlimits dropped |
| Filesystem | `off` (full host FS, exactly as today) |
| Network | `unrestricted`, and the metadata/link-local block is **not** enforceable without a netns (this gap is surfaced) |
| Privilege | `inherit` (no UID drop) |

This guarantees enabling-by-default **cannot hard-break** a degraded install: in
the limit (a macOS dev satellite with no primitives at all), the effective
behavior collapses to "today + output truncation + env denylist", and the run
record/startup log states plainly which layers are not enforced. The per-layer
`onUnavailable` design is unchanged — an operator who *wants* fail-closed on a
sensitive check sets `onUnavailable: "fail"` on that item, accepting that it
won't run on a host that can't enforce it.

### D1.3 (§6.3) — Upgrade notes (ship in docs + changeset + release notes)

On upgrade to the version that lands this:

- **Hardening becomes active by default.** No config change is needed to get it;
  the default profile (§6.1) applies to every script run.
- **What the default profile allows (so existing checks keep working):** outbound
  HTTP/socket egress to non-metadata destinations; temp-file writes in the
  per-run scratch dir; managed-package imports; up to 60 CPU-s / 512 MiB / 256
  PIDs / 1024 FDs / 5 MiB output / 256 MiB single file.
- **What it newly blocks (potential behavior changes):** reading/writing
  *arbitrary host filesystem paths* outside the scratch dir (on hosts with a
  namespace wrapper); requests to `169.254.169.254` / link-local / cloud
  metadata; fork-bombs / runaway memory / disk-fill beyond the caps; the
  forbidden env keys (`LD_PRELOAD`, `NODE_OPTIONS`, ...). A script relying on any
  of these must be adjusted or scoped with a per-item override.
- **On macOS / restricted containers:** the strong layers degrade to the
  portable subset and are surfaced; nothing hard-breaks (§6.2).
- **How to opt out:**
  - Globally — set the global default policy to `{ enabled: false }` (§5.8).
  - Per check/action — set `sandbox: { enabled: false }` on that item, or loosen
    a single layer (e.g. `sandbox: { resources: { memoryBytes: 2147483648 } }`).
- **How to verify what your host enforces:** read the startup capability log
  line, or the per-run `EffectiveSandbox` report (`enforced` + `downgrades`).

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
This is what makes D1 (on-by-default) safe: on-by-default + `degrade` means a
host that can't enforce a layer keeps running on the portable subset and says
so, instead of breaking on upgrade. The "degrade surfaces, never hides"
guarantee is a hard requirement, not a nicety.

> **Summary of sign-off asks:** **none outstanding.** D1 (on-by-default with
> opt-out) is LOCKED by the maintainer; D2/D3/D4 are recommended and reversible.
> Only operational confirmation remains: the §5.8 settings-surface attachment
> and the dedicated low-priv UID/GID to ship as the `drop-to-uid` target.

---

## 7. Phased breakdown (each shippable)

Each phase is an independent PR. **Sequencing note for on-by-default (D1):** the
*default profile* (§6.1) requests `filesystem: scratch-plus-ro` and the
metadata/network block, which only become enforceable once Phases 2-3 land. To
honor "on-by-default cannot break upgrade", the global default profile is
**activated atomically in Phase 4** alongside the settings surface and docs;
Phases 1-3 build and ship each capability with the schema default `enabled:true`
but a still-conservative *global* default (so intermediate releases don't enable
a half-built layer). Each layer's `degrade` path (§6.2) is implemented in the
same phase that introduces the layer, so the moment Phase 4 flips the global
default profile on, every layer either enforces or degrades-and-surfaces — never
hard-fails by default.

### Phase 1 — Scaffold + portable resource caps + privilege drop + env denylist

- New `script-sandbox/` module: `policy.ts` (incl. `DEFAULT_SANDBOX_PROFILE`
  scaffold + `mergeSandboxPolicy`), `capabilities.ts`, `env-guard.ts`
  (move `SAFE_ENV_VARS` here), `report.ts`, `wrapper.ts` (uid/gid + `prlimit`
  prelude + output-truncation hook only — no namespaces yet).
- Add `sandbox?` to both runner option interfaces; wire `buildSpawnHardening`
  into both `spawn` calls; attach `EffectiveSandbox` to both results.
- Add `sandboxConfigField()` to the four config schemas; call sites derive +
  merge global default with per-item override. Implement the resources/privilege
  `degrade` fallbacks (§6.2).
- Forbidden-env-key denylist active when enabled.
- **Interim global default:** resources + privilege + env denylist only
  (`filesystem.off`, `network.unrestricted`) so this release enables only
  fully-built layers.
- **Milestone:** on a root Linux host, a check is capped (CPU/mem/PID/files) and
  dropped to a low-priv UID; output truncation + env denylist work everywhere;
  a macOS host degrades-and-surfaces, runs unchanged.

### Phase 2 — Wrapper detection + filesystem isolation

- `capabilities.ts` detects `bwrap`/`nsjail`/`firejail` + userns; `wrapper.ts`
  builds the FS-confinement argv (`scratch-only`, `scratch-plus-ro`); implement
  the FS `degrade`-to-`off` fallback (§6.2).
- ESM runner passes its `mkdtemp` dir as scratch and `resolutionRoot/node_modules`
  as the RO bind.
- **Milestone:** with `bwrap` installed, a script can no longer read arbitrary
  host files; managed-package imports still resolve under `scratch-plus-ro`; a
  no-wrapper host degrades to `off` and surfaces it.

### Phase 3 — Network egress control

- `network.ts` builds net-namespace + IP/CIDR allowlist / `deny` rules and the
  always-on metadata/link-local block; implement the network `degrade` fallback
  (§6.2, incl. surfacing the un-enforceable metadata block).
- **Milestone:** a `deny` script cannot reach the network; an `allowlist`
  script reaches only listed CIDRs; metadata IP blocked; a no-netns host
  degrades and surfaces.

### Phase 4 — Default profile ON + operator surface + docs + observability

- Land `DEFAULT_SANDBOX_PROFILE` (§6.1) as the **shipped global default** and
  flip the global default to it (this is the on-by-default activation).
- Global-default settings surface (§5.8); per-run downgrade surfacing in run
  records; startup capability log line.
- Full docs (§9), incl. the §6.3 upgrade notes. Changeset with the
  `### BREAKING` note (§10).
- **Milestone:** every install gets the default profile out of the box; a
  degraded host runs the portable subset and says so; the "no sandbox" doc
  section is gone; operators can opt out globally or per item.

---

## 8. Per-phase test matrix

All tests use **bun's test runner** (`.agent/rules/testing.md`). Unit/fakes by
default; the genuinely-OS-dependent assertions are env-gated integration tests
(skip with a clear message when the capability is absent — never silently pass).

**Cross-cutting (added every phase that touches the default profile)**
- **Default-profile / upgrade-compat:** with NO per-item config (i.e. an
  existing check upgraded in place), a representative "ordinary" script —
  `fetch` to a non-metadata URL, write a temp file in the scratch dir, light CPU
  — runs **successfully** under `DEFAULT_SANDBOX_PROFILE`. Asserts on-by-default
  does not break the common case. Add the matching abuse-case assertions:
  fork-bomb / OOM / disk-fill are capped; `fetch("http://169.254.169.254/...")`
  is refused (on a netns-capable host); reads outside scratch fail (on a
  wrapper-capable host).
- **Degraded-host:** with capabilities forced to "none available" (mock
  `detectSandboxCapabilities()` → macOS/no-wrapper/non-root) and the default
  profile, the run **still succeeds** (no hard-break), `result.sandbox.enforced`
  shows the strong layers `false`, and `downgrades` lists every dropped layer
  with a reason. Asserts the §6.2 guarantee. A second variant with
  `onUnavailable:"fail"` on a sensitive item asserts that item refuses to run
  on the degraded host (clean failure, no spawn).

**Phase 1**
- `policy.test.ts`: schema parse/defaults (`enabled` defaults `true`)/`.strict()`
  rejects unknown keys; `mergeSandboxPolicy` precedence (per-item over global);
  `DEFAULT_SANDBOX_PROFILE` round-trips through `sandboxPolicySchema.parse`.
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
   **on-by-default posture + the default profile (§6.1)**, what it allows/blocks
   (the §6.3 upgrade notes), how to opt out (global + per-item), the
   cross-platform enforcement matrix, and the "degrade surfaces, never hides"
   guarantee. Keep the existing env / concurrency sections.
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
  `@checkstack/integration-script-backend`. Summary: "Add a layered OS-level
  sandbox (resource limits, filesystem isolation, network egress control,
  privilege dropping) around the shared script runners, **enabled by default**
  via a permissive default profile, with capability detection and surfaced
  graceful degradation." This bump carries a **`### BREAKING`** note (per beta
  policy: minor bump, BREAKING described in text — `.agent/rules/changesets.md`):
  > **BREAKING:** Script and shell health checks / automation actions now run
  > inside an OS-level sandbox **by default**. The default profile allows
  > ordinary outbound HTTP, temp-file writes in the per-run scratch dir, and
  > generous CPU/memory; it newly blocks reads/writes of arbitrary host paths
  > (on hosts with a namespace wrapper), requests to cloud-metadata/link-local
  > IPs, fork-bombs/OOM/disk-fill beyond the caps, and the forbidden env keys
  > (`LD_PRELOAD`, `NODE_OPTIONS`, ...). On macOS / restricted containers the
  > strong layers degrade to the portable subset and are surfaced — nothing
  > hard-breaks. Opt out globally with `{ enabled: false }` on the global
  > sandbox policy, or per check/action via the `sandbox` config field. See the
  > upgrade notes in the script-sandbox docs.
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
2. **D1 (on-by-default with opt-out) is LOCKED** — no sign-off needed. Confirm
   only the operational details: the §5.8 settings-surface attachment and the
   dedicated low-priv UID/GID to ship as the `drop-to-uid` target.
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
divergence surfaced not assumed, **on-by-default via the permissive default
profile with degrade-not-break on degraded hosts**) are documented above. **D1
is LOCKED (on-by-default with opt-out)** by the maintainer; D2–D4 recommended
and reversible; no sign-off outstanding (only the §5.8 settings surface + the
low-priv UID target need operational confirmation).*
