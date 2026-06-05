import React from "react";
import { Link } from "react-router-dom";
import { formatDistanceToNow } from "date-fns";
import { resolveRoute } from "@checkstack/common";
import {
  catalogRoutes,
  type System,
  type SystemSignal,
  type SystemSignalTone,
} from "@checkstack/catalog-common";
import { Card, CardContent, DynamicIcon, cn } from "@checkstack/ui";
import { ChevronRight } from "lucide-react";
import type { ProblemSystem } from "../logic/systemSignals";

const chipBg: Record<SystemSignalTone, string> = {
  error: "bg-destructive/10 text-destructive",
  warn: "bg-warning/10 text-warning",
  info: "bg-info/10 text-info",
};

const dotBg: Record<SystemSignalTone, string> = {
  error: "bg-destructive",
  warn: "bg-warning",
  info: "bg-info",
};

const dotRing: Record<SystemSignalTone, string> = {
  error: "ring-destructive/20",
  warn: "ring-warning/20",
  info: "ring-info/20",
};

const glow: Record<SystemSignalTone, string> = {
  error: "from-destructive/[0.08]",
  warn: "from-warning/[0.08]",
  info: "from-info/[0.07]",
};

const SignalRow: React.FC<{ signal: SystemSignal; isLowPower: boolean }> = ({
  signal,
  isLowPower,
}) => {
  const body = (
    <>
      <span
        className={cn(
          "flex size-6 shrink-0 items-center justify-center rounded-md",
          chipBg[signal.tone],
        )}
      >
        <DynamicIcon name={signal.iconName} className="h-3.5 w-3.5" />
      </span>
      <span className="shrink-0 text-sm font-medium text-foreground">
        {signal.label}
      </span>
      {signal.detail && (
        <span className="min-w-0 truncate text-xs text-muted-foreground">
          {signal.detail}
        </span>
      )}
      {signal.href && (
        <ChevronRight
          className={cn(
            "ml-auto h-4 w-4 shrink-0 text-muted-foreground/70 opacity-0 group-hover/row:opacity-100",
            !isLowPower && "transition-opacity",
          )}
          aria-hidden="true"
        />
      )}
    </>
  );

  if (!signal.href) {
    return (
      <li className="flex items-center gap-2.5 px-2 py-1.5">{body}</li>
    );
  }

  return (
    <li>
      <Link
        to={signal.href}
        className={cn(
          "group/row -mx-2 flex items-center gap-2.5 rounded-lg px-2 py-1.5 hover:bg-muted/60 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring",
          !isLowPower && "transition-colors",
        )}
      >
        {body}
      </Link>
    </li>
  );
};

/**
 * One "needs attention" system in the dashboard overview: an elevated card whose
 * name links to the system, with a tone-coded status dot, a "since" pill, and one
 * row per contributed {@link SystemSignal} deep-linking to the page the issue
 * originates from. Signals are pre-sorted worst-first by the aggregator.
 */
export const ProblemSystemCard: React.FC<{
  system: System;
  problem: ProblemSystem;
  isLowPower: boolean;
}> = ({ system, problem, isLowPower }) => {
  return (
    <Card
      className={cn(
        "group/card relative overflow-hidden border-border/70",
        !isLowPower &&
          "transition-all duration-200 hover:border-border hover:shadow-lg hover:shadow-black/5",
      )}
    >
      {!isLowPower && (
        <div
          className={cn(
            "pointer-events-none absolute inset-x-0 top-0 h-20 bg-gradient-to-b to-transparent",
            glow[problem.worstTone],
          )}
          aria-hidden="true"
        />
      )}
      <CardContent className="relative p-4">
        <div className="flex items-center gap-2.5">
          <span
            className={cn(
              "size-2.5 shrink-0 rounded-full",
              dotBg[problem.worstTone],
              !isLowPower && cn("ring-4", dotRing[problem.worstTone]),
            )}
            aria-hidden="true"
          />
          <Link
            to={resolveRoute(catalogRoutes.routes.systemDetail, {
              systemId: system.id,
            })}
            className={cn(
              "min-w-0 flex-1 truncate text-[15px] font-semibold text-foreground",
              !isLowPower && "transition-colors",
              "hover:text-primary",
            )}
          >
            {system.name}
          </Link>
          {problem.oldestSince && (
            <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
              {formatDistanceToNow(new Date(problem.oldestSince), {
                addSuffix: true,
              })}
            </span>
          )}
        </div>
        <ul className="mt-3 space-y-0.5">
          {problem.signals.map((signal, index) => (
            <SignalRow
              key={`${signal.source}-${index}`}
              signal={signal}
              isLowPower={isLowPower}
            />
          ))}
        </ul>
      </CardContent>
    </Card>
  );
};
