---
"@checkstack/frontend": patch
---

Fix vendor build output conflicting with Vite's publicDir

The vendor build was outputting to `public/vendor/` which is inside Vite's `publicDir` (`public/`). This caused Vite to skip copying public directory contents (including `favicon.svg`) to the `dist/` folder during production builds, resulting in missing static assets in the Docker container.

- Move vendor build output from `public/vendor/` to `dist/vendor/`
- Set `emptyOutDir: false` on the main build to preserve the pre-built vendor bundles
