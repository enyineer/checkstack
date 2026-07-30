---
"@checkstack/backend": minor
"@checkstack/about-frontend": minor
---

Show the platform release version on the About page

The About page showed only `@checkstack/backend`'s package version, which cannot
be matched to a GitHub release, a Docker tag or a changelog entry - those all
carry `@checkstack/release`'s version, which advances on every release while the
core package's does not.

Both are now shown, explicitly labelled, with the release version leading and
linked to its GitHub tag.

The release version is baked in at version time by a new
`generate:release-version` script (checked in CI, mirroring the docs index)
rather than read at runtime: `@checkstack/release` is private and therefore
absent from `node_modules` in an npm install, so a relative-path read would work
in the monorepo and Docker image and silently fail everywhere else.
