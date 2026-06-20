---
title: "Changesets"
description: "How Checkstack uses Changesets to version and publish workspace packages."
---

Checkstack uses [Changesets](https://github.com/changesets/changesets) to version and publish the workspace packages under `core/` and `plugins/`. Each user-facing change ships with a markdown file under `.changeset/` that describes which packages bump, the bump type, and a one-line summary. CI consumes these on merge to open or update a "Version Packages" pull request that, when merged, publishes new releases.

## When to add a changeset

Add a changeset for any change that affects the runtime behaviour of a package or plugin:

- Bug fixes
- New features
- Breaking changes
- Performance improvements
- API changes

You typically do not need a changeset for:

- Documentation-only changes
- Test-only changes
- CI/build configuration changes
- Development tooling changes

> [!IMPORTANT]
> Checkstack is currently in BETA. Do NOT bump packages with a major version - use a minor bump and add `BREAKING CHANGES:` to the changeset body instead.

## Creating a changeset

Run the interactive prompt from the repo root:

```bash
bun changeset
```

This walks you through three questions: which packages are affected, what bump type each gets (patch/minor/major), and a one-line summary. The result is a new markdown file under `.changeset/`.

### Example

```markdown
---
"@checkstack/auth-backend": patch
"@checkstack/auth-frontend": patch
---

Fixed authentication token refresh bug that caused users to be logged out unexpectedly.
```

Commit this file along with your code changes.

## Release flow

1. Open your PR. The Changeset Bot comments confirming a changeset is present (or flags that one might be missing).
2. Merge to `main`. The release GitHub Action opens or updates a "Version Packages" PR with bumped `package.json` versions and updated `CHANGELOG.md` files.
3. Review and merge the "Version Packages" PR. Packages are published to npm and tags are pushed.

## Empty changesets

For documentation-only PRs that still trip the changeset bot, create an empty changeset that satisfies the check without bumping anything:

```bash
bun changeset --empty
```

## Troubleshooting

- **"No changesets present"** - run `bun changeset` and commit the resulting file.
- **Wrong packages selected** - delete the file under `.changeset/` and run `bun changeset` again.
- **Need to edit a changeset** - open the markdown file under `.changeset/` directly and adjust the YAML header or summary.

## See also

- [Security maintenance](/checkstack/developer-guide/tooling/security-maintenance/) - how the auto-remediation workflow emits a changeset so a release ships the fix.
- [Changesets documentation](https://github.com/changesets/changesets)
- [Semantic Versioning](https://semver.org/)
- `.changeset/README.md` in the repo for an at-a-glance summary.
