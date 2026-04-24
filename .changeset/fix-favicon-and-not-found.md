---
"@checkstack/backend": patch
"@checkstack/ui": minor
"@checkstack/frontend": patch
---

Fix favicon not loading in production container and add NotFound page

- **Backend**: Fix static file serving so root-level files like `/favicon.svg` are served from the dist directory before the SPA fallback catches them
- **UI**: Add `NotFound` component with stacked-checkmark logo, physics-inspired falling "4" animation, and low-power device fallback
- **Frontend**: Add catch-all `*` route to display the NotFound page for unmatched routes, and add the Checkstack logo to the navbar
- **Favicon**: Redesign with stacked checkmarks in the brand purple/indigo palette
