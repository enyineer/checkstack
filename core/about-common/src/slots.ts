import { createSlot } from "@checkstack/frontend-api";

/**
 * Render slot for the platform "About Checkstack" page.
 *
 * The About page is a general, platform-owned surface, so it must not depend on
 * any specific plugin. Instead, plugins CONTRIBUTE self-contained section cards
 * to this slot (each fully responsible for its own access gating and data
 * loading), and the About page renders whatever is registered. This inverts the
 * dependency: the owning plugin imports `@checkstack/about-common`, never the
 * other way round.
 *
 * Extensions declare an optional `priority` in their metadata; the page renders
 * them sorted ascending (lower = first), mirroring `DashboardSlot`. Unspecified
 * priority defaults to 0.
 *
 * @example
 * import { createSlotExtension } from "@checkstack/frontend-api";
 * import { AboutSectionsSlot } from "@checkstack/about-common";
 *
 * createSlotExtension(AboutSectionsSlot, {
 *   id: "my-plugin.about.section",
 *   metadata: { priority: 10 },
 *   load: () =>
 *     import("./MyAboutSection").then((m) => ({ default: m.MyAboutSection })),
 * });
 */
export const AboutSectionsSlot = createSlot<undefined, { priority?: number }>(
  "plugin.about.sections",
);
