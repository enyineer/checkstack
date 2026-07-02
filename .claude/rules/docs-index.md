# Docs index regeneration

The AI assistant's docs search is backed by a **generated index** of the docs
site: `core/ai-backend/src/generated/docs-index.ts`. It is generated from the
markdown under `docs/src/content/docs/` and checked in CI
(`generate:docs-index:check`); a stale index fails typecheck/CI.

Whenever you add, edit, delete, or rename ANY file under
`docs/src/content/docs/`, in the SAME PR:

1. Regenerate the index:

   ```bash
   bun run generate:docs-index
   ```

2. Commit the regenerated `core/ai-backend/src/generated/docs-index.ts`.
3. Add a **patch** changeset for `@checkstack/ai-backend` describing the docs
   content the index now reflects (the regeneration is a code change to that
   package). See `.changeset/` history for the established wording pattern.
