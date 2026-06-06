---
"@checkstack/frontend": patch
---

Disable production source maps by default in the frontend build. Source maps over
the bundled Monaco / VS Code (`@codingame/*`) editor stack roughly doubled the
build's time and peak memory and shipped several MB of `.js.map` into the image -
enough to OOM-thrash a CI runner (the Docker image build hung on the frontend
build step). They are now off by default; opt in locally with
`VITE_SOURCEMAP=true bun run --filter '@checkstack/frontend' build` when you need
to debug the production bundle.

Also fixes the `@module-federation/vite` `shared` typing (its published type omits
`eager` and types `requiredVersion` as `string`, narrower than the MF runtime),
so `vite.config.ts` no longer reports type errors.
