import React from "react";
import { Award } from "lucide-react";
import { Badge } from "@checkstack/ui";

interface AchievementBadgeProps {
  achievement: string;
  unlockedAt: Date;
}

const ACHIEVEMENT_META: Record<
  string,
  { label: string; emoji: string; description: string }
> = {
  first_steps: {
    label: "First Steps",
    emoji: "🎯",
    description: "First SLO defined",
  },
  iron_uptime: {
    label: "Iron Uptime",
    emoji: "🛡️",
    description: "30-day compliance streak",
  },
  diamond_uptime: {
    label: "Diamond Uptime",
    emoji: "💎",
    description: "90-day compliance streak",
  },
  budget_miser: {
    label: "Budget Miser",
    emoji: "💰",
    description: ">90% budget remaining at window end",
  },
  clean_sheet: {
    label: "Clean Sheet",
    emoji: "✨",
    description: "Zero breaches in a quarter",
  },
  nines_club: {
    label: "Nines Club",
    emoji: "🏆",
    description: "99.99% over 365 days",
  },
  cascade_breaker: {
    label: "Cascade Breaker",
    emoji: "🛑",
    description: "Upstream resolved before SLO impact",
  },
  full_coverage: {
    label: "Full Coverage",
    emoji: "🔒",
    description: "All systems in group have SLOs",
  },
  rapid_recovery: {
    label: "Rapid Recovery",
    emoji: "⚡",
    description: "SLO compliance restored within 5 min",
  },
};

/**
 * Renders an achievement badge with emoji, label, and tooltip description.
 */
export const AchievementBadge: React.FC<AchievementBadgeProps> = ({
  achievement,
  unlockedAt,
}) => {
  const meta = ACHIEVEMENT_META[achievement];
  const label = meta?.label ?? achievement;
  const emoji = meta?.emoji ?? "🏅";
  const description = meta?.description ?? "";

  return (
    <div className="group relative inline-flex" title={description}>
      <Badge variant="outline" className="gap-1.5 cursor-default">
        <span>{emoji}</span>
        <span>{label}</span>
      </Badge>
      {/* Tooltip on hover */}
      <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 hidden group-hover:block z-10">
        <div className="bg-popover border border-border rounded-md shadow-md px-3 py-2 text-xs whitespace-nowrap">
          <div className="font-medium">{label}</div>
          <div className="text-muted-foreground">{description}</div>
          <div className="text-muted-foreground mt-1">
            {new Date(unlockedAt).toLocaleDateString("en-US", {
              month: "short",
              day: "numeric",
              year: "numeric",
            })}
          </div>
        </div>
      </div>
    </div>
  );
};

/**
 * Renders a placeholder for systems with no achievements yet.
 */
export const NoAchievements: React.FC = () => (
  <div className="flex items-center gap-2 text-sm text-muted-foreground">
    <Award className="w-4 h-4" />
    <span>No achievements unlocked yet</span>
  </div>
);
