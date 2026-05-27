Voice & tense
  - Second person ("you") for guides and concepts.
  - Imperative for walkthroughs ("Click Save", "Run the command").
  - Present-tense impersonal for reference/contract pages.
  - No "we" except in design plans (historical, leave alone).

Headings
  - Every page MUST have frontmatter `title:` and `description:` (one sentence, under 160 chars).
  - Do NOT include an in-body H1 - Starlight renders the frontmatter title as the H1.
  - Sentence case for all headings.
  - Open every page with one intro paragraph below frontmatter, then jump to `## Section`.

Code examples
  - Every "how-to" page MUST include at least one runnable code/config example.
  - Reference pages MUST include the canonical type signature or contract snippet.
  - Use ```ts, ```bash, ```yaml, ```env, ```json. Avoid bare ``` fences.

Callouts (GitHub-style, picked up by remark-github-admonitions-to-directives)
  - > [!NOTE], > [!TIP], > [!IMPORTANT], > [!WARNING], > [!CAUTION]

Cross-links
  - Use slug-based Starlight links: `/checkstack/user-guide/concepts/health-checks/` - NOT `./health-checks.md`.
  - For external code, use GitHub URL pinned to `main`.

Dashes
  - NEVER em-dashes in new content. Use normal hyphens or rewrite.
  - Pages predating this rule may keep em-dashes until rewritten.
