import js from "@eslint/js";
import tseslint from "typescript-eslint";
import unicorn from "eslint-plugin-unicorn";
import reactHooks from "eslint-plugin-react-hooks";
import checkstackPlugin from "./scripts/eslint-rules/checkstack-plugin.mjs";

export default tseslint.config(
  {
    ignores: [
      "**/node_modules/**",
      "**/dist/**",
      "**/storybook-static/**",
      "**/.tsbuild/**",
      // Runtime data dir (CHECKSTACK_DATA_DIR default): the script-packages
      // store caches installed npm packages here. Git-ignored runtime output,
      // not project source - never lint it.
      "**/.data/**",
      // Developer-cockpit workspace (PR-preview worktrees, db snapshots, and
      // the preview instance's own script-packages cache). Git-ignored runtime
      // output, same rationale as `.data`.
      ".dev/**",
      // Local git worktrees (e.g. Agent `isolation: worktree`, manual
      // `git worktree add` under `.claude/worktrees/`). Each is a SEPARATE
      // branch's full checkout that happens to live under the repo root; linting
      // it here lints another branch's source, which is meaningless. Git-ignored
      // local artifact, same rationale as `.dev/**`. CI checks out a single
      // branch, so these never exist there.
      ".claude/worktrees/**",
      "**/drizzle/**",
      "**/public/vendor/**",
      "**/*.test.ts*",
      "**/*.e2e.ts",
      // Workflow orchestration scripts run in the Workflow runtime, where
      // `agent`/`phase`/`parallel`/`log` are injected globals. They are not
      // normal app/runtime source, so linting them produces false no-undef
      // errors. (They are plain JS, not TypeScript - no type checking either.)
      "**/*.workflow.mjs",
      // Test fixtures: hand-written consumer files (some intentionally
      // uncompilable, e.g. negative resolution cases) exercised by tests, not
      // project source.
      "**/test/fixtures/**",
      // Astro-generated files and the docs site source. Astro provides its
      // own type checking via `astro check`; running our ESLint rules over
      // its virtual-module imports (`astro:content`) and generated `.astro/`
      // dir produces false positives.
      "docs/**",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    plugins: {
      unicorn,
      "react-hooks": reactHooks,
      checkstack: checkstackPlugin,
    },
    rules: {
      // Silent-catch convention (code-quality review Finding 7): a `catch`
      // block that swallows the error MUST carry a one-line reason comment.
      // `no-empty` with `allowEmptyCatch: false` implements exactly this: a
      // comment makes the block non-empty, so an empty `catch {}` WITH a reason
      // comment is allowed while a truly-empty `catch {}` is an error. Declared
      // explicitly here (rather than relying on js.configs.recommended's
      // default) so the convention is self-documenting and cannot silently
      // regress if the preset default changes. This block has no `files`
      // restriction, so the rule applies to both backend and frontend source.
      "no-empty": ["error", { allowEmptyCatch: false }],
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      ...unicorn.configs.recommended.rules,
      "unicorn/filename-case": "off",
      "unicorn/prevent-abbreviations": "off",
      "unicorn/prefer-module": "off",
      "unicorn/no-nested-ternary": "off",
      // `null` is a legitimate value in this codebase, especially around
      // Drizzle: an insert with `null` writes a NULL column, while
      // `undefined` is interpreted as "leave this column unset". The two
      // are NOT interchangeable, so we don't lint them away.
      "unicorn/no-null": "off",
      // React hooks rules
      "react-hooks/rules-of-hooks": "error",
      "react-hooks/exhaustive-deps": "warn",
      // Ban raw `instanceof Error` — use extractErrorMessage() instead
      "no-restricted-syntax": [
        "error",
        {
          selector:
            "BinaryExpression[operator='instanceof'][right.name='Error']",
          message:
            "Do not use 'instanceof Error' directly. Use extractErrorMessage() from @checkstack/common instead.",
        },
        {
          // Ban calling parse/safeParse/parseAsync/strict on a Versioned's
          // `.schema` member: `<x>.schema.parse(...)` etc. Parsing the raw
          // zod schema bypasses the migration chain (stored data) or the
          // intention-revealing fresh-input path. The Versioned
          // implementation itself is exempted via a file-scoped override.
          selector:
            "CallExpression[callee.type='MemberExpression'][callee.property.name=/^(parse|safeParse|parseAsync|strict)$/][callee.object.type='MemberExpression'][callee.object.property.name='schema']",
          message:
            "Do not parse via a Versioned's .schema. For STORED data use .parse()/.parseAssumingV1()/.parseStrictAssumingV1() (migrate-then-validate). For FRESH current-version input use .validate()/.safeValidate().",
        },
      ],
      // The monaco-vscode editor API must only be imported (as a value) by the
      // guarded accessor `core/ui/src/components/CodeEditor/monacoGuard.ts`.
      // Direct value imports let `monaco.editor.*` / `monaco.languages.*` calls
      // auto-initialize the monaco-vscode services on first use, which collides
      // with @typefox's editor init ("Services are already initialized") and
      // leaves the editor blank. Type-only imports are fine (no runtime).
      "@typescript-eslint/no-restricted-imports": [
        "error",
        {
          paths: [
            {
              name: "@codingame/monaco-vscode-editor-api",
              message:
                'Do not import the raw monaco editor-api as a value. Import the guarded `monaco` runtime from "./monacoGuard" instead (it throws in dev if used before the services are initialized). Type-only imports (`import type * as monaco`) are allowed.',
              allowTypeImports: true,
            },
          ],
        },
      ],
      // Custom checkstack rules
      "checkstack/no-direct-rpc-in-components": "error",
      "checkstack/no-mutation-in-deps": "error",
      "checkstack/enforce-architecture-deps": "error",
      "checkstack/no-extraneous-runtime-deps": "error",
      "checkstack/enforce-package-metadata": "error",
      "checkstack/no-eslint-disable-any": "error",
      // Test-runner isolation soundness (scripts/run-tests.ts). The runner keeps
      // the suite fast by running the bulk in ONE shared process and pulling only
      // the files that pollute process globals into a separate `--isolate` pass,
      // detecting that set by grepping each TEST file for `mock.module` / global
      // assignment / `spyOn(global*)`. That detection is defeated if such a call
      // hides in an importable NON-test module, so this rule forbids those calls
      // outside `*.test.*` files (the sanctioned `test-preload.ts` aside). Test
      // files themselves are unaffected (they are in the top-level `ignores` and
      // are isolated by the runner). Severity is `error`: the codebase already
      // conforms and a violation silently breaks the runner's partition, leaking
      // a mock into unrelated suites - a correctness risk, not a style nit.
      "checkstack/no-shared-process-test-pollution": "error",
      // Reactive automation engine backstop (plan §6.4, §15.6). Severity is
      // intentionally `warn` and MUST NOT be escalated to `error`: it informs
      // authors that entity state should flow through `defineEntity`, it does
      // not block CI (see .claude/rules/code-style-guide.md). The entity hooks
      // it flags are removed in the migration phase (plan §9).
      "checkstack/no-unmanaged-entity-state": [
        "warn",
        {
          // §9 "keep" hooks that happen to match the naming shape but are NOT
          // entity-change events (lifecycle / config-change signals). They are
          // exempted so the rule's signal stays on genuine entity hooks.
          allowedHookIds: [
            // The framework's own internal entity-change hook — this IS the
            // canonical defineEntity emit path (plan §6.1), not an off-pattern
            // manual hook, so it must never be flagged.
            "automation.entity.changed",
            // §9 "keep" hooks: lifecycle / config-change signals that match the
            // naming shape but are not entity-change events.
            "auth.user.deleted",
            "healthcheck.assignment.changed",
            // logstream user-pattern cross-pod cache-sync broadcast (a sibling
            // of logstream.tokens.invalidated): keeps each pod's in-memory Drain
            // tree in step after a user pattern is created/deleted. NOT a
            // reactive entity — the durable source of truth is the log_patterns
            // row; this hook only invalidates a process-local throughput cache.
            "logstream.patterns.changed",
          ],
          // Migrated-domain former state columns to flag direct writes to.
          // EMPTY at this phase — no domain is migrated yet (plan §16 step 4
          // populates this as each domain moves to defineEntity), so part (b)
          // matches nothing on the current codebase.
          deniedColumns: [],
          // Tables declared non-reactive via declareNonReactiveState (plan §5).
          // Mirror each runtime declaration here so part (b)'s matches on that
          // table are suppressed. EMPTY until a denylisted column exists.
          allowedTables: [],
        },
      ],
      // Horizontal-scale safety tripwire (.claude/rules/state-and-scale.md). A
      // reactive entity's `read` must resolve from shared/durable storage so a
      // write on pod A is visible on pod B. Severity is intentionally `warn`
      // and MUST NOT be escalated to `error`: it is a single-file forcing
      // function at the `defineEntity` boundary, not a sound cross-module
      // analysis (the deterministic check is the cross-pod IT test). See
      // .claude/rules/code-style-guide.md ("do NOT escalate warnings to errors").
      "checkstack/no-pod-local-entity-state": [
        "warn",
        {
          // Entity kinds exempt from the durable-read check (none today).
          allowedKinds: [],
          // Durable-accessor function names that resolve to shared storage but
          // don't match the built-in name shapes (createXEntityRead / getMany*
          // / *EntityStates). Empty: every real site matches a built-in shape.
          durableAccessors: [],
        },
      ],
    },
  },
  // Performance degradation tripwire (.agent/rules/performance.md): animation /
  // backdrop-blur classes must be gated behind usePerformance().isLowPower.
  // Scoped to frontend source ONLY (the rule is a no-op elsewhere anyway, but
  // scoping keeps the intent explicit). Storybook stories and test files are
  // excluded — stories intentionally showcase effects unguarded, and *.test.ts*
  // is already in the top-level `ignores`. Severity is intentionally `warn` and
  // MUST NOT be escalated to `error` (nor forced green via --max-warnings 0):
  // a sound static proof of a runtime guard is impossible, so this informs
  // authors rather than blocking CI (see .agent/rules/code-style-guide.md).
  {
    files: [
      "core/*-frontend/src/**/*.{ts,tsx}",
      "plugins/*-frontend/src/**/*.{ts,tsx}",
      "core/ui/src/**/*.{ts,tsx}",
    ],
    ignores: ["core/ui/stories/**"],
    rules: {
      "checkstack/no-unguarded-animation": [
        "warn",
        {
          // Cheap/always-on tokens that never need a guard. Empty by default;
          // add single-frame entry tokens here only with a measured reason.
          allowedClasses: [],
          // Extra guard identifier names beyond the built-in `isLowPower`.
          additionalGuardIdentifiers: [],
        },
      ],
      // Form-stability tripwire: a `useEffect` that seeds local state from one
      // of its dependencies re-fires on every dependency change - including
      // background query refetches driven by realtime signals - and wipes the
      // user's in-progress edits (the catalog SystemEditor / EnvironmentEditor
      // and healthcheck PlatformDefaultsDialog bugs). Seed once with
      // `useSeedFormOnOpen` / `useInitOnceForKey` instead. Severity is
      // intentionally `warn` and MUST NOT be escalated to `error` (nor forced
      // green via `--max-warnings 0`): the rule cannot see whether a given
      // parent passes a referentially-stable prop today, so it informs authors
      // rather than blocking CI (see .claude/rules/code-style-guide.md).
      "checkstack/no-state-seed-in-effect": "warn",
    },
  },
  // Gate-fusion nudge (PROTOTYPE scope): prefer `.useGatedMutation()` over raw
  // `.useMutation()` so authorization is fused into the call and cannot drift.
  // Scoped to the automation pages where the gate-fused hooks are wired as a
  // demonstration; widen once the pattern is adopted repo-wide. Severity is
  // intentionally `warn` and MUST NOT be escalated to `error`: a syntactic rule
  // cannot tell a fusable single-instance mutation from a legitimately-ungated
  // one (global/admin action, or a per-row mutation gated as an array), so it
  // informs rather than blocks (see .claude/rules/code-style-guide.md).
  {
    files: ["core/automation-frontend/src/pages/**/*.{ts,tsx}"],
    rules: {
      "checkstack/prefer-gated-mutation": "warn",
    },
  },
  // Enforced-by-design cache invalidation: the role-membership tables (`role`,
  // `role_access_rule`, `user_role`) may only be written through
  // `RoleMembershipStore`, which welds each write to its per-pod cache eviction
  // + cross-pod broadcast (see that file's header). A raw drizzle write
  // elsewhere would silently skip invalidation - a cross-pod authorization-
  // staleness bug - so it is an error. The store file itself and the boot-time
  // access-rule-sync seeder (cold cache) are exempt, as are tests.
  {
    files: ["core/auth-backend/src/**/*.ts"],
    ignores: [
      // The store IS the sanctioned writer; access-rule-sync is the one
      // sanctioned BOOT-TIME seeder (cold cache, see its header). Tests are
      // exempt (mock DBs / IT setup).
      "core/auth-backend/src/role-membership-store.ts",
      "core/auth-backend/src/access-rule-sync.ts",
      "**/*.test.ts",
    ],
    rules: {
      "checkstack/no-direct-role-membership-writes": [
        "error",
        { tables: ["role", "roleAccessRule", "userRole"] },
      ],
    },
  },
  // Enforced-by-design status-cache coherence for the healthcheck plugin. The
  // derived per-system health status is served from a per-pod cache kept
  // cluster-coherent by broadcast invalidation (SystemHealthStatusCache in
  // cache.ts). Two fences keep it honest:
  //  - Every READ goes through `cache.read`/`readBulk`/`readMatrix`, never a raw
  //    `service.getSystemHealthStatus(...)`. Exempt: the cache facade (the one
  //    wrapper) and the executor / entity-compute paths that MUST read live to
  //    detect a transition.
  //  - Every run INSERT goes through the executor or service ingest writer, which
  //    weld the write to `cache.reconcile` / invalidation. Exempt: those two files.
  // Tests are exempt (mock DBs / stub caches).
  {
    files: ["core/healthcheck-backend/src/**/*.ts"],
    ignores: ["**/*.test.ts"],
    rules: {
      "checkstack/no-direct-system-status-read": [
        "error",
        { methods: ["getSystemHealthStatus"] },
      ],
    },
  },
  // Read-fence exemptions: the cache facade is the sanctioned wrapper; the
  // executor + entity compute read live for transition detection; the service
  // owns the raw compute (`this.getSystemHealthStatus`).
  {
    files: [
      "core/healthcheck-backend/src/cache.ts",
      "core/healthcheck-backend/src/queue-executor.ts",
      "core/healthcheck-backend/src/health-entity.ts",
      "core/healthcheck-backend/src/service.ts",
    ],
    rules: {
      "checkstack/no-direct-system-status-read": "off",
    },
  },
  // Run-insert fence: only the executor + service ingest may land runs (they
  // reconcile/invalidate the status cache); a raw insert elsewhere is an error.
  {
    files: ["core/healthcheck-backend/src/**/*.ts"],
    ignores: [
      "core/healthcheck-backend/src/queue-executor.ts",
      "core/healthcheck-backend/src/service.ts",
      "**/*.test.ts",
    ],
    rules: {
      "checkstack/no-direct-health-run-insert": [
        "error",
        { tables: ["healthCheckRuns"] },
      ],
    },
  },
  // Frontend packages: ban console.* to enforce proper error handling
  {
    files: [
      "core/*-frontend/src/**/*.{ts,tsx}",
      "plugins/*-frontend/src/**/*.{ts,tsx}",
    ],
    ignores: [
      "**/logger-api.ts",
      "**/plugin-loader.ts",
      "**/plugin-registry.ts",
      "**/SignalProvider.tsx",
      "**/runtime-config.tsx",
    ],
    rules: {
      "no-console": "error",
    },
  },
  // Standalone scripts: exempt from instanceof Error ban (can't import workspace packages)
  {
    files: ["scripts/**/*.ts"],
    rules: {
      "no-restricted-syntax": "off",
    },
  },
  // Standalone satellite agent: not a platform plugin, exempt from metadata requirement
  {
    files: ["core/satellite/src/**/*.ts"],
    rules: {
      "checkstack/enforce-package-metadata": "off",
    },
  },
  // The guarded monaco accessor is the ONE place allowed to import the raw
  // monaco editor-api as a value (it wraps it with the dev-time init guard).
  {
    files: ["core/ui/src/components/CodeEditor/monacoGuard.ts"],
    rules: {
      "@typescript-eslint/no-restricted-imports": "off",
    },
  },
  // The Versioned implementation legitimately calls `this.schema.parse` /
  // `.strict()` — it IS the migrate-then-validate primitive every other call
  // site is routed through. Disable the .schema parse ban for this one file.
  {
    files: ["core/backend-api/src/config-versioning.ts"],
    rules: {
      "no-restricted-syntax": "off",
    },
  }
);
