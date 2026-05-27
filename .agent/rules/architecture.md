# Documentation

The docs site is an [Astro Starlight](https://starlight.astro.build/) project
under [`docs/`](../../docs/). All authored markdown lives in
[`docs/src/content/docs/`](../../docs/src/content/docs/) and is served at
`https://enyineer.github.io/checkstack/` by the
[`deploy-docs`](../../.github/workflows/deploy-docs.yml) workflow.

## Where to read & write

- For documentation regarding the architecture, always check the markdown
  files under `docs/src/content/docs/`. The legacy top-level paths (e.g.
  `docs/architecture/...`) **no longer exist** — the canonical location is
  `docs/src/content/docs/architecture/...`, and so on for every section.
- If you make architectural changes or change interfaces, you **must**
  update the relevant page(s) under `docs/src/content/docs/` in the same PR
  so the docs don't drift.
- Every new markdown file needs Starlight frontmatter — at minimum a
  `title:`, optionally `description:`. Without `title`, Starlight falls
  back to the H1 with a build-time warning; prefer explicit frontmatter.
- Cross-page links use Starlight's slug-based routing: link to
  `/checkstack/<section>/<slug>/` (with the `/checkstack` base path), not
  to the underlying `.md` file. For internal references inside MDX you can
  also use Starlight's `<LinkCard>` / `<CardGrid>` components.
- GitHub-flavored alerts (`> [!NOTE]`, `> [!TIP]`, `> [!WARNING]`,
  `> [!CAUTION]`, `> [!IMPORTANT]`) render as Starlight `<Aside>` callouts
  via the `remark-github-admonitions-to-directives` plugin, so prefer that
  syntax over hand-rolled HTML.

## When updating docs

When you touch any of the following, ship doc updates in the **same PR**:

- A backend, frontend, or common plugin's public API or schema.
- A platform contract: events, slots, signals, queue jobs, kind-registry
  extensions, GitOps providers.
- A new package under `core/` or `plugins/` (add a page or section).
- A new plugin type or any change to the dependency rules.
- A workflow change that affects how the platform is run, deployed, or
  released.
- A new `@checkstack/ui` component (also add a Storybook story — see
  [`code-style-guide.md`](./code-style-guide.md)).

If a change is intentionally **not** documented (e.g. an internal
refactor with no external surface change), say so explicitly in the PR
description so reviewers don't have to guess.
