---
"@checkstack/dependency-frontend": patch
---

Fix the dependency map page's scrolling and make its header consistent with the
rest of the app. The page sized its canvas with a fixed `calc(100vh - 12rem)`,
which could overshoot the available space (double-scroll) depending on viewport
chrome, and it used a bespoke `<h1>` header with no icon. It now renders through
`PageLayout` (with the `GitBranch` nav icon and `fillHeight`), so the React Flow
canvas fills the app shell's bounded flex content area and only it scrolls/pans -
the page itself never scrolls.
