---
"create-checkstack-plugin": patch
---

Fix `Cannot find module '@checkstack/scripts/scaffold'` when running `bun create checkstack-plugin`. The `0.1.0` release pinned `@checkstack/scripts@0.3.4`, which predates the `./scaffold` subpath export (first shipped in `0.4.0`). This release pins a version of `@checkstack/scripts` that exposes `./scaffold`. `0.1.0` has been deprecated on npm.
