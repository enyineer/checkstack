---
"@checkstack/dependency-frontend": patch
---

Make the dependency map overlay panels responsive on small screens. The edge
editor and legend panels now cap their width to the viewport
(`w-[calc(100vw-2rem)] sm:w-72` / `max-w-[calc(100vw-2rem)] sm:max-w-64`) and the
top-right action buttons wrap instead of overflowing, so the chrome no longer
covers the canvas on phones. No behavior change on desktop.
