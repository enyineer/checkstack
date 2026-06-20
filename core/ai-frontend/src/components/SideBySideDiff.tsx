import { Fragment } from "react";
import { computeLineDiff, type DiffLine, type DiffSegment } from "../lib/line-diff";

type Side = "left" | "right";
type Kind = DiffLine["kind"];

/** Line-level background tint for one side, GitHub-style (red left, green right). */
function lineBg({ side, kind }: { side: Side; kind: Kind }): string {
  if (kind === "equal") return "";
  if (side === "left") {
    return kind === "added" ? "bg-muted/30" : "bg-destructive/10";
  }
  return kind === "removed" ? "bg-muted/30" : "bg-success/10";
}

/** Line-number gutter text colour, matching the line tint. */
function gutterText({ side, kind }: { side: Side; kind: Kind }): string {
  if (kind === "equal") return "text-muted-foreground/70";
  if (side === "left") {
    return kind === "added" ? "text-muted-foreground/30" : "text-destructive/70";
  }
  return kind === "removed" ? "text-muted-foreground/30" : "text-success/80";
}

/** The `+` / `-` change marker for one side. */
function marker({ side, kind }: { side: Side; kind: Kind }): string {
  if (kind === "equal") return "";
  if (side === "left") return kind === "added" ? "" : "-";
  return kind === "removed" ? "" : "+";
}

/** Render a side's segments, strongly highlighting the changed tokens. */
function Segments({
  segments,
  side,
}: {
  segments: DiffSegment[] | null;
  side: Side;
}) {
  if (!segments) return null;
  const strong = side === "left" ? "bg-destructive/30" : "bg-success/40";
  return (
    <>
      {segments.map((segment, index) =>
        segment.emphasis ? (
          <span key={index} className={`rounded-sm ${strong}`}>
            {segment.text}
          </span>
        ) : (
          <Fragment key={index}>{segment.text}</Fragment>
        ),
      )}
    </>
  );
}

function Gutter({ no, side, kind }: { no: number | null; side: Side; kind: Kind }) {
  return (
    <div
      className={`select-none px-2 text-right tabular-nums ${gutterText({
        side,
        kind,
      })} ${lineBg({ side, kind })} ${side === "right" ? "border-l border-border" : ""}`}
    >
      {no ?? ""}
    </div>
  );
}

function Code({
  segments,
  side,
  kind,
}: {
  segments: DiffSegment[] | null;
  side: Side;
  kind: Kind;
}) {
  return (
    <div className={`flex gap-1 px-1 ${lineBg({ side, kind })}`}>
      <span aria-hidden className="w-2 shrink-0 select-none text-center opacity-70">
        {marker({ side, kind })}
      </span>
      <pre className="m-0 min-w-0 flex-1 whitespace-pre-wrap break-words">
        <Segments segments={segments} side={side} />
      </pre>
    </div>
  );
}

/**
 * Render a before -> after change as a GitHub-style SPLIT diff: old text in the
 * left column, new on the right, line-number gutters, `+`/`-` markers, per-line
 * red/green tint, and word-level highlight of the exact changed tokens (via
 * {@link computeLineDiff}). Lightweight - no editor stack. Long lines wrap; the
 * columns share the available width.
 */
export function SideBySideDiff({
  before,
  after,
}: {
  before: string;
  after: string;
}) {
  const rows = computeLineDiff({ before, after });
  return (
    <div className="overflow-hidden rounded-md border border-border bg-surface">
      <div className="grid grid-cols-[auto_1fr_auto_1fr] font-mono text-xs leading-relaxed">
        {rows.map((row, index) => (
          <Fragment key={index}>
            <Gutter no={row.leftNo} side="left" kind={row.kind} />
            <Code segments={row.left} side="left" kind={row.kind} />
            <Gutter no={row.rightNo} side="right" kind={row.kind} />
            <Code segments={row.right} side="right" kind={row.kind} />
          </Fragment>
        ))}
      </div>
    </div>
  );
}
