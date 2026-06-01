---
name: hustle
description: Autonomously work a task with focused sub-agents and a code -> review -> fix loop. Accepts a free-form task, one/many issues, or a whole project board.
argument-hint: "[free-form task | issue # / URL | board URL | 'all open']"
disable-model-invocation: true
---

# Hustle

You are the **orchestrator**. Drive the work below largely autonomously, but
clear genuine open questions with the user **before** starting the autonomous
phase. You are responsible for the final outcome of every task.

What to work on: **$ARGUMENTS**
(If empty, ask the user what to work on.)

## Resolve the input first

The argument can be any of these — detect which and adapt:

- **Free-form task / prompt** (e.g. "add rate limiting to the login route"):
  treat the prompt itself as the spec. No GitHub issue is required. If it
  describes several independent pieces, split it into tasks; if it's one thing,
  it's one task.
- **One or more issues** (numbers like `#239` or issue URLs): fetch each with
  `gh issue view` and treat each as a task.
- **A project board URL or "all open"**: enumerate the items
  (`gh project item-list` / `gh issue list`) and treat each as a task.

For issue/board inputs, dump each full issue body to a temp file (e.g.
`/tmp/work/<id>.md`) so sub-agents can read the complete spec without bloating
your context. For a free-form task, pass the spec to the sub-agent inline.

## Right-size the machinery

Scale ceremony to the work — KISS. A single small task is usually **one coding
agent + one review pass**, not a fleet. A large multi-issue board is where the
parallel worktrees, plan-first track, and many agents pay off. Don't spin up
infrastructure a one-line fix doesn't need; don't under-build a 20-issue board.

## Operating principles

- Follow this repo's rules exactly: `@CLAUDE.md` and everything under
  `@.claude/rules/` (architecture/docs-in-same-PR, changesets — BETA means
  **minor** bumps with `BREAKING CHANGES:` in the text, never major —,
  state-and-scale, testing/TDD, typecheck project references, code style: no
  `any`, no `eslint-disable`, zod validation, typed object params).
- YAGNI / KISS / DRY, but don't enforce them where unreasonable. **Deviate from
  a plan only for a real benefit — complexity / "blast radius" alone is not a
  valid reason to deviate or to skip scope.**
- Default to **not pushing**: commit on a task branch and leave it for the
  user's review. Only push / open PRs when the user asks.
- Be concise with the user. Block only for decisions that are genuinely theirs.

## Phase 1 — Understand, then clear open questions (BLOCKING)

1. Read/understand every task in full (the prompt, or each issue body — not just
   titles).
2. Triage each into: **small/clear** (build now), **large greenfield /
   design-led** (plan-first — confirm the plan before coding), **docs-only**, or
   **out-of-scope / external** (flag, don't attempt).
3. Collect open questions. Adopt the stated assumption / sensible default where
   one exists and resolve it yourself. **Only escalate decisions that are
   genuinely the user's** — high blast radius, irreversible, architectural, or
   product calls — batched into `AskUserQuestion` (recommended option first,
   labelled "(Recommended)"). Don't start the autonomous phase until answered.

## Phase 2 — Isolated branch / worktree per task

- For each task, work on its own branch off `main`. For >1 task, pre-create
  worktrees yourself, sequentially, to avoid `git worktree add` races:
  `git worktree add ../<repo>-wt/<id> -b task/<id-or-slug> main`.
- Branch naming: `task/<issue#>-<slug>` for issue-backed work, else
  `task/<slug>` derived from the prompt.

## Phase 3 — Dispatch focused coding sub-agent(s)

For each build-now task, dispatch ONE coding sub-agent (run independent ones in
parallel as background agents; sequence dependent ones). Each agent:

- **Model**: Sonnet for small/mechanical work, **Opus for design/complex or
  high-blast-radius** work. Match the thinking level (`think hard` / `ultrathink`)
  to difficulty.
- Works **only** in its assigned branch/worktree; is given the full spec (issue
  file or inline prompt) + reads `CLAUDE.md` + `.claude/rules/`; stays in scope.
- Uses the repo's package manager (detect from the lockfile); installs first.
  TDD: real test coverage and a regression test for bug fixes. Adds a changeset
  when functionality changes. Updates docs in the **same** change when a public
  API / schema / platform contract changes. Runs typecheck + lint + the touched
  packages' tests and fixes every error it introduces.
- Commits with a Conventional Commit; **does not push, does not open a PR.**

> **Test gotcha (this repo):** CI runs `bun test` from the repo **root**, which
> does NOT load per-package DOM/happy-dom preloads. So **frontend tests must be
> DOM-free** — follow the `*.logic.ts` + `*.logic.test.ts` split (e.g.
> `ScriptTestPanel.logic.ts`); component-render tests pass locally with
> `cwd=core/ui` but fail in root CI. Tell coding agents this up front.

## Phase 4 — Plan-first for large features

For large greenfield / design-led tasks, dispatch a planning agent (Opus,
`ultrathink`) that writes an implementation-ready plan to
`.claude/plans/<name>.md`, matching the depth/rigor of the exemplars
(`.claude/plans/reactive-automation-engine.md`,
`.claude/plans/automation-platform.md`): verified `file:line` anchors, concrete
DDL / type signatures, phased breakdown, per-phase test matrix, docs
deliverables, and every open question resolved with a recommended decision.
Review the plans, then lock the maintainer decisions via `AskUserQuestion`
before any build.

## Phase 5 — Review -> fix loop (you own the verdict)

For each finished coding/plan agent:

1. Dispatch a **reviewer** sub-agent: judge correctness & completeness vs the
   spec, rule-adherence, test quality (would the test fail if the fix were
   reverted?), security & state-and-scale (no pod-local state for shared values;
   watch for IDOR / authz scoping), and scope creep. It outputs findings tagged
   `[BLOCKER]/[MAJOR]/[MINOR]/[NIT]` + a verdict.
2. If the findings are legitimate, dispatch the coding agent again to fix them
   (amend or add a commit), then re-verify.
3. **You** do the final review and decide done. Iterate until you're confident.
   (For a truly trivial diff you may self-review instead of spawning a reviewer —
   don't add ceremony where it has no value.)

## Phase 6 — Report

Surface to the user: what landed (per task + branch), the decisions you made,
the review findings you acted on, anything skipped/blocked and why, and any
items needing their sign-off. Then offer next steps (push / open PRs / create
issues or per-phase issues from plans / clean up worktrees) — don't do those
unless asked.

## Multi-agent gotchas (learned the hard way)

- **Don't let parallel agents guess issue/PR numbers.** When agents create
  issues concurrently, numbers interleave — have each capture the number the API
  returns, or set cross-references in a **serial pass after** everything exists.
- **Use GitHub's native relationships, not just body text.** Set parent /
  sub-issue (`addSubIssue`) and dependencies (`addBlockedBy`) via the GraphQL
  API so epic progress bars and the dependency graph work; mirror them to the
  board status.
- Launch independent background agents in a **single message** so they run
  concurrently; bound concurrency on heavy tasks (full install + `tsgo -b` per
  worktree) to a few at a time.
