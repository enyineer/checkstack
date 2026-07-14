---
"@checkstack/frontend": patch
"@checkstack/scripts": patch
---

Pin `@module-federation/vite` (1.16.15) and `@module-federation/runtime`
(2.7.0) exactly in the host, matching the already-pinned plugin frontend
template. This repo's Renovate policy only runs automerged lock-file
maintenance within the hand-curated `package.json` ranges - a caret range on
the Module Federation packages meant a broken upstream release (like 1.17.1)
could ride into the single maintenance PR once past the release-age cooldown,
fail CI there, and block every other security update until untangled. MF is
the host<->remote ABI surface, so host and scaffold template must move
together: a new lockstep guard test fails whenever one pin is bumped without
the other. Resolved versions are unchanged (the lockfile already held these);
future MF bumps are now deliberate edits gated by the full CI, including the
external-plugin lifecycle test.
