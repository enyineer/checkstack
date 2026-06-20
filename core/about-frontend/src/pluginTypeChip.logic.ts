/**
 * Visual encoding for a plugin's type column on the About page.
 *
 * Each plugin type gets a stable, distinct hue plus a dot so the type reads via
 * more than one channel (color + a discrete pill shape). The hue choices echo
 * the original `typeBadgeVariant` mapping in spirit (backend = primary lead,
 * frontend = info/blue, common = neutral) but render as a multi-encoded chip
 * rather than a generic badge.
 */
export type PluginTypeChipStyle = {
  /** Container classes for the pill (background + text + ring). */
  readonly pill: string;
  /** Classes for the leading status dot. */
  readonly dot: string;
};

/**
 * The known plugin types. Anything outside this set falls back to the neutral
 * "common" treatment, mirroring the original `default` badge branch.
 */
export type KnownPluginType = "backend" | "frontend" | "common";

const CHIP_STYLES: Record<KnownPluginType, PluginTypeChipStyle> = {
  backend: {
    pill: "bg-primary/10 text-primary ring-1 ring-inset ring-primary/20",
    dot: "bg-primary",
  },
  frontend: {
    pill: "bg-info/10 text-info ring-1 ring-inset ring-info/20",
    dot: "bg-info",
  },
  common: {
    pill: "bg-muted text-muted-foreground ring-1 ring-inset ring-border/70",
    dot: "bg-muted-foreground",
  },
};

const NEUTRAL_STYLE = CHIP_STYLES.common;

/**
 * Resolves the chip style for a plugin type. Unknown values degrade to the
 * neutral style so an unexpected type never renders unstyled.
 */
export function pluginTypeChipStyle(type: string): PluginTypeChipStyle {
  switch (type) {
    case "backend": {
      return CHIP_STYLES.backend;
    }
    case "frontend": {
      return CHIP_STYLES.frontend;
    }
    case "common": {
      return CHIP_STYLES.common;
    }
    default: {
      return NEUTRAL_STYLE;
    }
  }
}
