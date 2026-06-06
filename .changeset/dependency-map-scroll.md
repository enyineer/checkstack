---
"@checkstack/dependency-frontend": patch
---

Fix the dependency map page filling height with a fixed `calc(100vh - 12rem)`,
which could overshoot the available space (double-scroll) depending on viewport
chrome. The page now fills the app shell's bounded flex content area via
`flex-1 min-h-0`, so the React Flow canvas sizes to the remaining space and only
it scrolls/pans - the page itself never scrolls. Same approach as the AI chat
page fix.
