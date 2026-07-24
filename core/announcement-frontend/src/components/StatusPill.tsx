/**
 * Both of this module's exports now come from `@checkstack/ui`.
 *
 * The tone table is re-exported rather than re-declared: a local copy once
 * silently omitted the blue `info` tone, so every info-severity surface fell
 * back to the grey `unknown` classes. The pill was one of six identical copies
 * across plugins and moved to `@checkstack/ui` wholesale.
 *
 * Kept as a module so this plugin's existing imports read unchanged.
 */
export { pillToneStyles as toneStyles, StatusPill } from "@checkstack/ui";
