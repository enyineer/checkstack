import React from "react";
import { usePluginClient } from "@checkstack/frontend-api";
import { SloApi } from "../api";
import { formatDistanceToNow } from "date-fns";
import { Card, CardContent, CardHeader, CardTitle } from "@checkstack/ui";
import { Trophy } from "lucide-react";

const ACHIEVEMENT_EMOJI: Record<string, string> = {
  first_steps: "🎯",
  iron_uptime: "🛡️",
  diamond_uptime: "💎",
  budget_miser: "💰",
  clean_sheet: "✨",
  nines_club: "🏆",
  cascade_breaker: "🛑",
  full_coverage: "🔒",
  rapid_recovery: "⚡",
};

const ACHIEVEMENT_LABEL: Record<string, string> = {
  first_steps: "First Steps",
  iron_uptime: "Iron Uptime",
  diamond_uptime: "Diamond Uptime",
  budget_miser: "Budget Miser",
  clean_sheet: "Clean Sheet",
  nines_club: "Nines Club",
  cascade_breaker: "Cascade Breaker",
  full_coverage: "Full Coverage",
  rapid_recovery: "Rapid Recovery",
};

interface MilestoneFeedProps {
  limit?: number;
}

/**
 * Organization-wide milestone feed showing recent achievement unlocks.
 * Fetches from getRecentMilestones and renders a chronological feed.
 */
export const MilestoneFeed: React.FC<MilestoneFeedProps> = ({
  limit = 10,
}) => {
  const sloClient = usePluginClient(SloApi);

  const { data } = sloClient.getRecentMilestones.useQuery({ limit });

  const milestones = data?.milestones;

  if (!milestones || milestones.length === 0) {
    return (
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm text-muted-foreground flex items-center gap-2">
            <Trophy className="w-4 h-4" />
            Recent Milestones
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-sm text-muted-foreground text-center py-4">
            No milestones achieved yet
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm text-muted-foreground flex items-center gap-2">
          <Trophy className="w-4 h-4" />
          Recent Milestones
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-3">
          {milestones.map((milestone, index) => {
            const emoji =
              ACHIEVEMENT_EMOJI[milestone.achievement] ?? "🏅";
            const label =
              ACHIEVEMENT_LABEL[milestone.achievement] ??
              milestone.achievement;

            return (
              <div
                key={`${milestone.systemId}-${milestone.achievement}-${index}`}
                className="flex items-start gap-3"
              >
                <span className="text-lg shrink-0">{emoji}</span>
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium">{label}</div>
                  <div className="text-xs text-muted-foreground">
                    {milestone.systemName ?? milestone.systemId}
                    <span className="mx-1">·</span>
                    {formatDistanceToNow(new Date(milestone.unlockedAt), {
                      addSuffix: true,
                    })}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
};
