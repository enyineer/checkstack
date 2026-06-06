---
"@checkstack/frontend": minor
---

Show a loading spinner on initial app load instead of a blank screen. The host
boots by awaiting plugin registration + Module Federation init before React
mounts, which left `#root` empty for a few seconds. `index.html` now renders an
inline, theme-aware boot splash (visible before the JS/CSS bundles load, with a
no-flash light/dark head start mirroring the saved theme, and reduced-motion
safe) that `main.tsx` removes once the app has rendered.
