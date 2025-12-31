---
---
# Changesets Workflow

This document describes the Changesets workflow used in the Checkmate monorepo for managing package versions and changelogs.

## Overview

Checkmate uses [Changesets](https://github.com/changesets/changesets) to manage versioning and changelog generation across all packages and plugins in the monorepo. This ensures that:

- All changes are properly documented
- Versions follow semantic versioning (semver)
- Changelogs are automatically generated
- Dependencies are kept in sync

## The Workflow

### 1. Making Changes

When you make changes to packages or plugins, you'll need to create a changeset to document those changes.

### 2. Creating a Changeset

Run the following command from the project root:

```bash
bun changeset
```

This interactive CLI will:
1. Ask you to select which packages have changed
2. Ask what type of version bump is needed (patch, minor, or major)
3. Prompt you to write a summary of the changes

The summary you write will appear in the changelog, so make it clear and descriptive.

### 3. Changeset File

A new markdown file will be created in `.changeset/` with a random name. The file looks like this:

```markdown
---
"@checkmate/auth-backend": patch
"@checkmate/auth-frontend": patch
---

Fixed authentication token refresh bug that caused users to be logged out unexpectedly
```

Commit this file along with your code changes.

### 4. Pull Request

When you create a pull request:
- The **Changeset Bot** will comment on your PR
- It will indicate whether a changeset is present or may be needed
- If you forgot to add a changeset, the bot provides a helpful link to create one

### 5. Merging to Main

When your PR is merged to `main`:
- The **Release GitHub Action** automatically triggers
- It creates or updates a "Version Packages" PR
- This PR includes:
  - Updated `package.json` versions
  - Generated/updated `CHANGELOG.md` files
  - Consumed (deleted) changeset files

### 6. Publishing

When the "Version Packages" PR is reviewed and merged:
- Package versions are officially bumped
- Changelogs are published
- The changes are ready for deployment

## When to Create a Changeset

### ✅ Create a changeset for:

- **Bug fixes** - Any fix that changes behavior
- **New features** - New functionality or capabilities
- **Breaking changes** - Changes that require users to update their code
- **Performance improvements** - Optimizations that affect runtime
- **API changes** - Changes to public interfaces
- **Dependency updates** - When updating dependencies that affect functionality

### ❌ Don't create a changeset for:

- **Documentation-only changes** - README updates, doc fixes
- **Test-only changes** - Adding or updating tests without code changes
- **CI/build configuration** - GitHub Actions, build scripts
- **Development tooling** - ESLint config, prettier, etc.
- **Refactoring** - Internal changes that don't affect the API or behavior

If you're unsure, create a changeset. It's better to have one than to miss documenting an important change.

## Semantic Versioning

Changesets follow [semantic versioning (semver)](https://semver.org/):

### Patch (0.0.X)
- Bug fixes
- Minor improvements
- Documentation updates (if they fix incorrect docs)
- No breaking changes

**Example**: Fixing a typo in an error message

### Minor (0.X.0)
- New features
- New functionality
- Backwards-compatible changes
- No breaking changes

**Example**: Adding a new optional parameter to a function

### Major (X.0.0)
- Breaking changes
- Removing features
- Changing existing behavior
- Incompatible API changes

**Example**: Removing a deprecated function or changing a required parameter

## Examples

### Example 1: Bug Fix

```bash
$ bun changeset
🦋  Which packages would you like to include?
◉ @checkmate/healthcheck-backend

🦋  Which packages should have a patch bump?
◉ @checkmate/healthcheck-backend

🦋  Please enter a summary for this change:
Fixed health check timeout handling to prevent false negatives
```

### Example 2: New Feature

```bash
$ bun changeset
🦋  Which packages would you like to include?
◉ @checkmate/catalog-frontend
◉ @checkmate/catalog-backend

🦋  Which packages should have a minor bump?
◉ @checkmate/catalog-frontend
◉ @checkmate/catalog-backend

🦋  Please enter a summary for this change:
Added ability to archive systems and groups in the catalog
```

### Example 3: Breaking Change

```bash
$ bun changeset
🦋  Which packages would you like to include?
◉ @checkmate/backend-api

🦋  Which packages should have a major bump?
◉ @checkmate/backend-api

🦋  Please enter a summary for this change:
BREAKING: Changed PluginContext interface to require logger instance
```

## Empty Changesets

If you need to bypass the changeset requirement (for docs-only PRs, etc.), you can create an empty changeset:

```bash
bun changeset --empty
```

This creates a changeset that won't bump any versions but satisfies the requirement.

## Tips

1. **Write clear summaries** - Your changeset summary becomes the changelog entry
2. **Be specific** - Describe what changed and why
3. **One changeset per PR** - Usually one changeset is enough, but you can create multiple if needed
4. **Review the Version PR** - Always review the generated Version Packages PR before merging
5. **Keep changesets small** - Smaller, focused changes are easier to review and release

## Troubleshooting

### "No changesets present"

If you see this error, you need to create a changeset:
```bash
bun changeset
```

### "Changeset already exists"

If you need to modify your changeset, edit the markdown file in `.changeset/` directly.

### "Wrong packages selected"

Delete the changeset file in `.changeset/` and run `bun changeset` again.

## Additional Resources

- [Changesets Documentation](https://github.com/changesets/changesets)
- [Semantic Versioning](https://semver.org/)
- [Changesets CLI](https://github.com/changesets/changesets/blob/main/docs/command-line-options.md)
