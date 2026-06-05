// Fixture (NEGATIVE): proves per-subpath isolation. `defineIntegration` is
// NOT part of the `@checkstack/sdk/healthcheck` surface, so importing it from
// that subpath MUST be a resolution/type error (TS2305). If this ever
// compiles, the subpaths are sharing a declaration file and the per-subpath
// `.d.ts` guarantee is broken.
import { defineIntegration } from "@checkstack/sdk/healthcheck";

export const x = defineIntegration;
