import React from "react";
import { Link } from "react-router";
import { formatDistanceToNow } from "date-fns";
import { resolveRoute, type AccessRule } from "@checkstack/common";
import { useApi, accessApiRef } from "@checkstack/frontend-api";
import {
  catalogRoutes,
  type System,
  type SystemSignal,
  type SystemSignalTone,
} from "@checkstack/catalog-common";
import { Card, CardContent, DynamicIcon, cn } from "@checkstack/ui";
import { ChevronRight } from "lucide-react";
import type { ProblemSystem } from "../logic/systemSignals";
import { pillToneStyles } from "@checkstack/ui";
import {
  resolveProblemToneStyle,
  signalCountCaption,
} from "./problemToneStyles";

/**
 * Per-signal chip tint. All three are rungs of the status ladder, so all three
 * come from its table - `info` used to reach for the general-purpose `--info`
 * accent, which put the same "Watch" signal in two different blues depending on
 * whether you were looking at the card or the fleet header.
 */
const chipBg: Record<SystemSignalTone, string> = {
  error: pillToneStyles.down.pill,
  warn: pillToneStyles.warn.pill,
  info: pillToneStyles.info.pill,
};

/** The icon + label + detail (+ hover chevron when `interactive`) of a signal. */
const SignalInner: React.FC<{
  signal: SystemSignal;
  isLowPower: boolean;
  interactive: boolean;
}> = ({ signal, isLowPower, interactive }) => (
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
    {interactive && (
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

/** Plain, non-clickable row (no href, or the user can't access the target). */
const SignalTextRow: React.FC<{ signal: SystemSignal; isLowPower: boolean }> = ({
  signal,
  isLowPower,
}) => (
  // Same horizontal box as SignalLinkRow (`-mx-2 px-2`) so text and link rows
  // line up - the link's negative margin would otherwise sit it 0.5rem left.
  <li className="-mx-2 flex items-center gap-2.5 px-2 py-1.5">
    <SignalInner signal={signal} isLowPower={isLowPower} interactive={false} />
  </li>
);

/** Clickable deep-link row. */
const SignalLinkRow: React.FC<{
  signal: SystemSignal;
  href: string;
  isLowPower: boolean;
}> = ({ signal, href, isLowPower }) => (
  <li>
    <Link
      to={href}
      className={cn(
        "group/row -mx-2 flex items-center gap-2.5 rounded-lg px-2 py-1.5 hover:bg-muted/60 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        !isLowPower && "transition-colors",
      )}
    >
      <SignalInner signal={signal} isLowPower={isLowPower} interactive />
    </Link>
  </li>
);

/**
 * A signal whose target page is permission-gated: render it as a link only when
 * the user satisfies its access rule, otherwise as plain text (so the user is
 * never sent to an "Access Denied" page). Own component so the `useAccess` hook
 * is called in a stable position regardless of the surrounding list.
 */
const GatedSignalRow: React.FC<{
  signal: SystemSignal;
  href: string;
  accessRule: AccessRule;
  isLowPower: boolean;
}> = ({ signal, href, accessRule, isLowPower }) => {
  const accessApi = useApi(accessApiRef);
  const { allowed } = accessApi.useAccess(accessRule);
  return allowed ? (
    <SignalLinkRow signal={signal} href={href} isLowPower={isLowPower} />
  ) : (
    <SignalTextRow signal={signal} isLowPower={isLowPower} />
  );
};

const SignalRow: React.FC<{ signal: SystemSignal; isLowPower: boolean }> = ({
  signal,
  isLowPower,
}) => {
  // No destination -> plain text.
  if (!signal.href) {
    return <SignalTextRow signal={signal} isLowPower={isLowPower} />;
  }
  // Gated destination -> link only if the user can actually open it.
  if (signal.accessRule) {
    return (
      <GatedSignalRow
        signal={signal}
        href={signal.href}
        accessRule={signal.accessRule}
        isLowPower={isLowPower}
      />
    );
  }
  // Destination needs no specific permission -> always a link.
  return <SignalLinkRow signal={signal} href={signal.href} isLowPower={isLowPower} />;
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
  const tone = resolveProblemToneStyle(problem.worstTone);
  const signalCount = problem.signals.length;

  return (
    <Card
      className={cn(
        "group/card relative overflow-hidden rounded-[var(--d-card-r)] border border-border/70 bg-gradient-to-b from-surface-2 to-surface",
        !isLowPower &&
          "shadow-[0_1px_2px_hsl(var(--foreground)/0.04),0_10px_30px_-14px_hsl(var(--foreground)/0.12)] transition-all duration-200 hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-xl",
      )}
    >
      {/* Tone-coded left accent stripe: status by position + hue, not color alone. */}
      <span
        className={cn("absolute inset-y-0 left-0 w-1", tone.accent)}
        aria-hidden="true"
      />
      {!isLowPower && (
        <div
          className={cn(
            "pointer-events-none absolute inset-x-0 top-0 h-20 bg-gradient-to-b to-transparent",
            tone.glow,
          )}
          aria-hidden="true"
        />
      )}
      <CardContent className="relative p-4 pl-5">
        <div className="flex items-start justify-between gap-3">
          {/* Number-led hero: the signal count is the dominant figure. */}
          <div className="min-w-0 flex-1">
            <div className="flex items-baseline gap-2">
              <span className="text-3xl font-bold leading-none tabular-nums text-foreground">
                {signalCount}
              </span>
              <span className="text-xs text-muted-foreground">
                {signalCountCaption(signalCount)}
              </span>
            </div>
            <Link
              to={resolveRoute(catalogRoutes.routes.systemDetail, {
                systemId: system.id,
              })}
              className={cn(
                "mt-1.5 block min-w-0 truncate text-[15px] font-semibold text-foreground",
                !isLowPower && "transition-colors",
                "hover:text-primary",
              )}
            >
              {system.name}
            </Link>
            {problem.oldestSince && (
              <p className="mt-0.5 text-xs text-muted-foreground">
                {formatDistanceToNow(new Date(problem.oldestSince), {
                  addSuffix: true,
                })}
              </p>
            )}
          </div>
          {/* Multi-encoded status pill: hue + dot + label. */}
          <span
            className={cn(
              "inline-flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium",
              tone.pill,
            )}
          >
            <span
              className={cn("size-1.5 rounded-full", tone.dot)}
              aria-hidden="true"
            />
            {tone.label}
          </span>
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
