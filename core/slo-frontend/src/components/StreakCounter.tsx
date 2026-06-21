import React from "react";
import { Flame, Trophy } from "lucide-react";
import { usePerformance } from "@checkstack/ui";
import { classifyStreak } from "./sloDisplay.logic";

interface StreakCounterProps {
  currentStreak: number;
  bestStreak: number;
}

/**
 * Fire-themed streak counter showing consecutive SLO-compliant days.
 * Current streak displays with a flame icon; best streak shown below.
 */
export const StreakCounter: React.FC<StreakCounterProps> = ({
  currentStreak,
  bestStreak,
}) => {
  const { isLowPower } = usePerformance();

  const getFlameColor = () => {
    switch (classifyStreak({ currentStreak })) {
      case "blazing": {
        return "text-amber-400";
      }
      case "hot": {
        return "text-orange-500";
      }
      case "warm": {
        return "text-orange-400";
      }
      default: {
        return "text-muted-foreground";
      }
    }
  };

  return (
    <div className="flex items-center gap-4">
      <div className="flex items-center gap-2">
        <Flame
          className={`w-5 h-5 ${getFlameColor()} ${currentStreak > 0 && !isLowPower ? "animate-pulse" : ""}`}
        />
        <span className="text-2xl font-bold tabular-nums">
          {currentStreak}
        </span>
        <span className="text-sm text-muted-foreground">
          {currentStreak === 1 ? "day" : "days"}
        </span>
      </div>
      {bestStreak > 0 && bestStreak > currentStreak && (
        <div className="flex items-center gap-1 text-sm text-muted-foreground">
          <Trophy className="w-3.5 h-3.5" />
          <span>Best: {bestStreak}d</span>
        </div>
      )}
    </div>
  );
};
