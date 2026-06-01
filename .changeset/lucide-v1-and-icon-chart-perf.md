---
"@checkstack/common": minor
"@checkstack/ui": minor
"@checkstack/backend-api": minor
"@checkstack/about-frontend": minor
"@checkstack/gitops-frontend": minor
"@checkstack/healthcheck-frontend": minor
---

Upgrade lucide-react to v1 and stop shipping the full icon set / chart libraries in the initial load.

**lucide-react 1.x (BREAKING for icon consumers).** lucide-react was unified from three drifting ranges (`^0.344`, `^0.468`, `0.562` - five copies in the store) to `^1.17.0` across all frontend packages. lucide v1 removed every brand icon, so the GitHub/GitLab marks are now vendored in `@checkstack/ui` (`GithubIcon`, `GitlabIcon`, `brandIcons`). A new `IconName` type (`LucideIconName | BrandIconName`) in `@checkstack/common` is the canonical icon-name type; `AuthStrategy.icon` and the `@checkstack/ui` card components accept it, so data-driven brand icon names (e.g. `icon: "Github"`) keep working. Renamed v0 alias icons (e.g. `AlertCircle`) still resolve.

  BREAKING: any external consumer importing a brand icon from `lucide-react` (e.g. `import { Github } from "lucide-react"`) must switch to the vendored `@checkstack/ui` brand icons or a custom SVG.

**Icon bundle perf.** `DynamicIcon` no longer eagerly imports lucide's `icons` map (~1600 icons, ~1 MB). The map now lives in a `React.lazy`-loaded `iconRegistry` chunk fetched on first data-driven icon render, while statically named-imported icons (`import { Plus } from "lucide-react"`) tree-shake normally. Brand icons render synchronously.

**Chart bundle perf.** The recharts-backed health-check charts (~300 KB) no longer ship in the initial load: the auto-chart slot extension lazy-loads its chart grid, and `HealthCheckSystemOverview` lazy-loads its drawer (which only opens on demand).
