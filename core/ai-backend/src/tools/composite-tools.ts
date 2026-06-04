import type { RegisteredAiTool } from "../tool-registry";
import { createDocsTools } from "./docs-tools";
import { createProbeUrlTool } from "./probe-url";

/**
 * ai-backend's OWN platform AI tools, registered through `aiToolExtensionPoint`.
 * These are genuinely cross-plugin / platform tools with no single owning plugin:
 * documentation grounding (bundled docs) and URL probing.
 *
 * Plugin-specific tools (health-check / automation propose-update-delete,
 * capability catalogs, and script-context tools) are owned by and registered
 * FROM their plugins via the same `aiToolExtensionPoint` - ai-backend does not
 * depend on any plugin's `*-common` to build them. The systemic-authz test in
 * `tool-set.e2e.test.ts` covers this set plus the projected read tools.
 */
export function buildCompositeTools(): RegisteredAiTool[] {
  return [
    // Docs grounding (effect: "read"; composes the bundled docs index).
    ...createDocsTools(),
    // URL introspection (effect: "read"): probe a public URL to see what it
    // returns before drafting check assertions. SSRF-guarded (no internal hosts).
    createProbeUrlTool(),
  ];
}
