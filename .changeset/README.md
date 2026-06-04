# Changesets

This folder contains [Changesets](https://github.com/changesets/changesets) for the Checkstack monorepo.

## What are Changesets?

Changesets are a way to manage versioning and changelogs in a monorepo. Each changeset is a markdown file that describes:
- Which packages are affected by a change
- What type of version bump is needed (patch, minor, or major)
- A summary of the changes for the changelog

## When to Create a Changeset

Create a changeset when you make changes that affect the functionality of packages or plugins:
- ✅ Bug fixes
- ✅ New features
- ✅ Breaking changes
- ✅ Performance improvements
- ✅ API changes

You typically **don't need** a changeset for:
- ❌ Documentation-only changes
- ❌ Test-only changes
- ❌ CI/build configuration changes
- ❌ Development tooling changes

## Never reference `@checkstack/sdk`

`@checkstack/sdk` is auto-generated and **version-stamped** from
`@checkstack/release` by `scripts/generate-sdk.ts` — it is **never** bumped via
a changeset. A changeset that names `@checkstack/sdk` would fight the stamp, so
`bun run generate:sdk:check` (run in CI) fails if any pending changeset
references it.

Because the SDK surface is generated from the per-plugin `*-common` contracts
and the script-context helper builders, any change to that surface **must**
carry a changeset on the underlying `*-common` (or platform) package. That bump
advances `@checkstack/release`, which re-stamps and republishes the SDK. CI
enforces this: `generate:sdk:check` fails when the generated SDK surface changes
relative to `main` with no pending changeset.

## How to Create a Changeset

Run the following command from the project root:

```bash
bun changeset
```

This will:
1. Ask which packages have changed
2. Ask what type of version bump is needed (patch/minor/major)
3. Prompt you to write a summary of the changes
4. Create a new changeset file in `.changeset/`

## Changeset Workflow

1. **Make your changes** to packages/plugins
2. **Create a changeset** using `bun changeset`
3. **Commit the changeset** along with your code changes
4. **Create a PR** - The Changeset Bot will comment on your PR
5. **Merge to main** - A "Version Packages" PR will be automatically created
6. **Review and merge** the Version Packages PR to publish new versions

## Semantic Versioning

- **Patch** (0.0.X): Bug fixes, minor improvements
- **Minor** (0.X.0): New features, non-breaking changes
- **Major** (X.0.0): Breaking changes

For more information, see the [Changesets documentation](https://github.com/changesets/changesets/blob/main/docs/intro-to-using-changesets.md).
