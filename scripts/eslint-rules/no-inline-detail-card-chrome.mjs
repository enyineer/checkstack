/**
 * Custom ESLint rule: no-inline-detail-card-chrome
 *
 * The system detail / overview page (`SystemDetailPage`) renders a family of
 * cards - the platform's own plus every plugin card contributed into its
 * `SystemDetailsSlot` (Logs / Metrics / Traces, health, dependency, SLO,
 * incident, anomaly, maintenance). They are meant to look identical. For a long
 * time each one hand-rolled the same surface as a copy-pasted className (and a
 * per-file `PANEL_SHADOW` constant), and it drifted: the telemetry
 * `LinkedStreamsCard` regressed to a flat `bg-card` with a hairline-only shadow,
 * so the three telemetry cards rendered visibly flatter than their siblings.
 *
 * The surface now lives in ONE place - `DetailCard` / `detailCardSurface` from
 * `@checkstack/ui`. This rule forbids re-declaring that chrome inline in the
 * card-family components (see the `files` scope in eslint.config.mjs), so a new
 * or edited card cannot silently diverge again. It fires on the three signatures
 * of the hand-rolled surface appearing in a string/template literal:
 *
 *   - `var(--d-card-r)`                          (the detail-card radius token)
 *   - `from-surface-2 to-surface`               (the surface gradient)
 *   - `0_10px_30px_-14px`                        (the elevation-shadow layer)
 *
 * The fix is always the same: render `<DetailCard>` (or apply `detailCardSurface`
 * / `detailCardSurfaceFlat`) instead of the inline classes. If a card genuinely
 * needs a bespoke surface here, disable the rule on that line WITH a reason:
 *   // eslint-disable-next-line checkstack/no-inline-detail-card-chrome -- <why>
 *
 * To bring a NEW system-overview card under this guard, add its file to the
 * rule's `files` scope in eslint.config.mjs.
 */

/** Signatures of the hand-rolled detail-card surface. */
const CHROME_SIGNATURES = [
  "var(--d-card-r)",
  "from-surface-2 to-surface",
  "0_10px_30px_-14px",
];

function matchedSignature(text) {
  return CHROME_SIGNATURES.find((sig) => text.includes(sig));
}

export const noInlineDetailCardChrome = {
  meta: {
    type: "problem",
    docs: {
      description:
        "Disallow hand-rolling the system-overview detail-card surface (`--d-card-r` radius / `from-surface-2` gradient / elevation shadow) inline in the card-family components. Use `DetailCard` / `detailCardSurface` from `@checkstack/ui` so the cards cannot drift apart.",
      recommended: true,
    },
    messages: {
      inlineChrome:
        "Don't hand-roll the system-overview detail-card surface inline (found `{{signature}}`). This is exactly how the Logs/Metrics/Traces cards drifted to a flat `bg-card`. Render `<DetailCard>` (or apply the `detailCardSurface` / `detailCardSurfaceFlat` class) from `@checkstack/ui` instead. If a bespoke surface is genuinely required here, add `// eslint-disable-next-line checkstack/no-inline-detail-card-chrome -- <reason>`.",
    },
    schema: [],
  },

  create(context) {
    function check(node, text) {
      const signature = matchedSignature(text);
      if (signature) {
        context.report({ node, messageId: "inlineChrome", data: { signature } });
      }
    }

    return {
      Literal(node) {
        if (typeof node.value === "string") check(node, node.value);
      },
      // Template literals (e.g. `... ${PANEL_SHADOW}`) - check the static parts.
      TemplateElement(node) {
        check(node, node.value.raw);
      },
    };
  },
};
