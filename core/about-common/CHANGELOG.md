# @checkstack/about-common

## 0.3.3

### Patch Changes

- Updated dependencies [f93ee7a]
- Updated dependencies [f93ee7a]
- Updated dependencies [f93ee7a]
  - @checkstack/common@0.22.0
  - @checkstack/frontend-api@0.14.0

## 0.3.2

### Patch Changes

- Updated dependencies [c55d7c6]
  - @checkstack/common@0.21.0
  - @checkstack/frontend-api@0.13.2

## 0.3.1

### Patch Changes

- Updated dependencies [faf98f5]
  - @checkstack/common@0.20.0
  - @checkstack/frontend-api@0.13.1

## 0.3.0

### Minor Changes

- 3047ed2: Move the assistant's saved memories into a permission-gated Sheet opened from the
  About page, and drop the oversized always-open memory card.

  - `@checkstack/about-common` now exports a new `AboutSectionsSlot` render slot
    (with an optional `priority` metadata, like `DashboardSlot`). Plugins
    contribute self-contained, self-gating section cards to the platform About
    page without the general About page depending on any specific plugin.
  - `@checkstack/about-frontend` renders `AboutSectionsSlot` on the "About
    Checkstack" page.
  - `@checkstack/ai-frontend` contributes a compact "Assistant memory" section with
    a **Memories** button that opens a Sheet listing every memory the caller can
    see (their preferences plus `system` memories for systems they can read). The
    section is hidden entirely, and fires no `listMemories` request, for users
    without `ai.memory.read`.

  BREAKING CHANGE (behavior): the per-system "Assistant memory" card previously
  shown on a catalog system's detail page (the `SystemDetailsSlot` contribution) is
  removed. Memories are still viewable and prunable from the About-page Sheet and
  the existing "Assistant memory" workspace page; in-context per-system viewing on
  the system detail page is no longer available. This also supersedes the earlier
  patch that gated that card on `ai.memory.read` (the card no longer exists).

### Patch Changes

- Updated dependencies [d9f4654]
- Updated dependencies [e430fbe]
- Updated dependencies [eab80e3]
- Updated dependencies [259b93c]
- Updated dependencies [0d912a3]
  - @checkstack/frontend-api@0.13.0
  - @checkstack/common@0.19.0

## 0.2.15

### Patch Changes

- Updated dependencies [defb97b]
  - @checkstack/common@0.18.0

## 0.2.14

### Patch Changes

- 2e20792: Declare `sideEffects` (CSS-only) so bundlers can tree-shake these packages' barrel exports

  These packages now declare `"sideEffects": ["**/*.css"]` in their
  `package.json`. This lets a consuming bundle drop unused barrel re-exports
  instead of pulling a whole package's component graph when only one
  provider/hook is imported (e.g. importing `SessionProvider` no longer dragged an
  admin form). It is build metadata only - no runtime behavior change.

  - @checkstack/common@0.17.0

## 0.2.13

### Patch Changes

- Updated dependencies [8cad340]
- Updated dependencies [8cad340]
  - @checkstack/common@0.17.0

## 0.2.12

### Patch Changes

- Updated dependencies [d2077bd]
  - @checkstack/common@0.16.0

## 0.2.11

### Patch Changes

- Updated dependencies [56e7c75]
  - @checkstack/common@0.15.0

## 0.2.10

### Patch Changes

- Updated dependencies [1fee9da]
  - @checkstack/common@0.14.1

## 0.2.9

### Patch Changes

- Updated dependencies [13373ce]
  - @checkstack/common@0.14.0

## 0.2.8

### Patch Changes

- Updated dependencies [9dcc848]
- Updated dependencies [9dcc848]
- Updated dependencies [9dcc848]
- Updated dependencies [9dcc848]
  - @checkstack/common@0.13.0

## 0.2.7

### Patch Changes

- Updated dependencies [6d52276]
  - @checkstack/common@0.12.0

## 0.2.6

### Patch Changes

- Updated dependencies [f23f3c9]
- Updated dependencies [f23f3c9]
  - @checkstack/common@0.11.0

## 0.2.5

### Patch Changes

- Updated dependencies [9016526]
  - @checkstack/common@0.10.0

## 0.2.4

### Patch Changes

- Updated dependencies [42abfff]
  - @checkstack/common@0.9.0

## 0.2.3

### Patch Changes

- Updated dependencies [50e5f5f]
  - @checkstack/common@0.8.0

## 0.2.2

### Patch Changes

- Updated dependencies [8d1ef12]
  - @checkstack/common@0.7.0

## 0.2.1

### Patch Changes

- Updated dependencies [d1a2796]
  - @checkstack/common@0.6.5

## 0.2.0

### Minor Changes

- 3589199: Add About page with platform information, license, contact details, and version information

  - New `about-common` package with plugin metadata
  - New `about-frontend` package with the About page and user menu item
  - New `/api/about` backend endpoint exposing core version and loaded plugin versions
  - Accessible via "About Checkstack" in the user menu dropdown
