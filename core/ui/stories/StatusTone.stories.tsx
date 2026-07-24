import type { Meta, StoryObj } from "@storybook/react";
import { pillToneStyles, type StatusPillTone, cn } from "../src";

const meta: Meta = {
  title: "Foundations/StatusTone",
};

export default meta;
type Story = StoryObj;

const TONES: StatusPillTone[] = ["ok", "warn", "down", "unknown", "info"];

/**
 * Renders each shared status tone as a pill (dot + label), so the token set -
 * including the new blue `info` hue outside the ok/warn/down ladder - is
 * reviewable in both light and dark themes.
 */
const ToneRow = ({ tone }: { tone: StatusPillTone }) => {
  const styles = pillToneStyles[tone];
  return (
    <div className="flex items-center gap-4">
      <span
        className={cn(
          "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium",
          styles.pill,
        )}
      >
        <span className={cn("size-1.5 rounded-full", styles.dot)} aria-hidden />
        {tone}
      </span>
      <span className={cn("h-6 w-1 rounded-full", styles.accent)} aria-hidden />
    </div>
  );
};

export const AllTones: Story = {
  render: () => (
    <div className="flex flex-col gap-3">
      {TONES.map((tone) => (
        <ToneRow key={tone} tone={tone} />
      ))}
    </div>
  ),
};

/**
 * How the incident/maintenance plugins map onto the tones. Notably the severity
 * ramp is blue(minor) -> amber(major) -> red(critical): a minor incident is the
 * lowest-impact problem, so it uses the blue `info` hue (not amber), leaving no
 * minor/major amber collision. Incident status "monitoring" and maintenance
 * "scheduled" also read as informational (blue).
 */
const MAPPING: Array<{ label: string; tone: StatusPillTone }> = [
  { label: "severity: minor", tone: "info" },
  { label: "severity: major", tone: "warn" },
  { label: "severity: critical", tone: "down" },
  { label: "status: monitoring / scheduled", tone: "info" },
  { label: "status: resolved / completed", tone: "ok" },
  { label: "status: cancelled", tone: "unknown" },
  { label: "announcement severity: info", tone: "info" },
  { label: "announcement severity: warning", tone: "warn" },
  { label: "announcement severity: critical", tone: "down" },
];

/**
 * The banner surface classes (`tint` + `border` + `text`, with `tintHover` for
 * the dismiss control). Announcement banners consume these so a full-bleed
 * strip is tinted by the SAME tone that drives its pill and accent stripe.
 */
export const BannerSurfaces: Story = {
  render: () => (
    <div className="flex flex-col gap-2">
      {TONES.map((tone) => {
        const styles = pillToneStyles[tone];
        return (
          <div
            key={tone}
            className={cn(
              "flex items-center gap-3 border px-4 py-2",
              styles.tint,
              styles.border,
            )}
          >
            <span className={cn("text-sm font-medium flex-1", styles.text)}>
              A {tone} announcement banner
            </span>
            <button
              type="button"
              className={cn(
                "rounded p-1 text-xs transition-colors",
                styles.text,
                styles.tintHover,
              )}
            >
              Dismiss
            </button>
          </div>
        );
      })}
    </div>
  ),
};

export const DomainMapping: Story = {
  render: () => (
    <div className="flex flex-col gap-3">
      {MAPPING.map(({ label, tone }) => {
        const styles = pillToneStyles[tone];
        return (
          <div key={label} className="flex items-center gap-3">
            <span
              className={cn(
                "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium",
                styles.pill,
              )}
            >
              <span
                className={cn("size-1.5 rounded-full", styles.dot)}
                aria-hidden
              />
              {tone}
            </span>
            <span className="text-sm text-muted-foreground">{label}</span>
          </div>
        );
      })}
    </div>
  ),
};
