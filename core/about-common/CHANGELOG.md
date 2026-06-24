# @checkstack/about-common

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
