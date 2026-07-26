import { useState } from "react";
import { Link } from "react-router";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
  Button,
  usePerformance,
} from "@checkstack/ui";
import type { NotificationSubject } from "@checkstack/notification-common";
import { getSubjectKindRenderer } from "./SubjectKindRegistry";

const STATUS_DOT_COLOR: Record<
  NonNullable<NotificationSubject["status"]>,
  string
> = {
  healthy: "bg-status-ok",
  degraded: "bg-status-warn",
  unhealthy: "bg-status-down",
  unknown: "bg-status-unknown",
};

interface NotificationSubjectsProps {
  subjects: NotificationSubject[];
  /** Inline cap before collapsing the rest into a "+N" overflow popover. */
  maxVisible?: number;
  /** Optional callback fired when a chip's link is clicked. */
  onSubjectClick?: () => void;
}

/**
 * Compact chip list of affected entities. Each chip shows the kind icon (via
 * the kind registry) and the subject name; clicking links to the subject's
 * url when present. Status maps to a small colored dot.
 *
 * On low-power devices, transitions are disabled.
 */
export function NotificationSubjects({
  subjects,
  maxVisible = 3,
  onSubjectClick,
}: NotificationSubjectsProps) {
  const [overflowOpen, setOverflowOpen] = useState(false);
  const { isLowPower } = usePerformance();

  if (subjects.length === 0) return <></>;

  const visible = subjects.slice(0, maxVisible);
  const overflow = subjects.slice(maxVisible);

  return (
    <div className="flex flex-wrap items-center gap-1.5 mt-2">
      {visible.map((subject) => (
        <SubjectChip
          key={`${subject.kind}:${subject.id}`}
          subject={subject}
          isLowPower={isLowPower}
          onClick={onSubjectClick}
        />
      ))}
      {overflow.length > 0 && (
        <Popover open={overflowOpen} onOpenChange={setOverflowOpen}>
          <PopoverTrigger asChild>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-6 px-2 text-xs"
            >
              +{overflow.length} more
            </Button>
          </PopoverTrigger>
          <PopoverContent
            className="w-72 p-2"
            align="start"
            onCloseAutoFocus={(e) => {
              e.preventDefault();
            }}
          >
            <div className="flex flex-col gap-1">
              {overflow.map((subject) => (
                <SubjectChip
                  key={`${subject.kind}:${subject.id}`}
                  subject={subject}
                  isLowPower={isLowPower}
                  onClick={() => {
                    setOverflowOpen(false);
                    onSubjectClick?.();
                  }}
                  fullWidth
                />
              ))}
            </div>
          </PopoverContent>
        </Popover>
      )}
    </div>
  );
}

interface SubjectChipProps {
  subject: NotificationSubject;
  isLowPower: boolean;
  onClick?: () => void;
  fullWidth?: boolean;
}

function SubjectChip({
  subject,
  isLowPower,
  onClick,
  fullWidth,
}: SubjectChipProps) {
  const renderer = getSubjectKindRenderer(subject.kind);
  const Icon = renderer.icon;
  const dotColor = subject.status
    ? STATUS_DOT_COLOR[subject.status]
    : undefined;

  const baseClass = [
    "inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md",
    "border border-border bg-card text-foreground",
    "text-xs font-medium max-w-[14rem] truncate",
    isLowPower ? "" : "transition-colors hover:bg-accent",
    fullWidth ? "w-full" : "",
  ]
    .filter(Boolean)
    .join(" ");

  const content = (
    <>
      <Icon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
      {dotColor && (
        <span
          className={`inline-block h-2 w-2 rounded-full shrink-0 ${dotColor}`}
          aria-label={subject.status ?? undefined}
        />
      )}
      <span className="truncate" title={`${renderer.label}: ${subject.name}`}>
        {subject.name}
      </span>
    </>
  );

  if (subject.url) {
    return (
      <Link to={subject.url} className={baseClass} onClick={onClick}>
        {content}
      </Link>
    );
  }

  return <span className={baseClass}>{content}</span>;
}
