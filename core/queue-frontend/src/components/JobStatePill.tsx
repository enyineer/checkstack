/**
 * A small neutral status pill used for a job's State in the jobs table and
 * mobile cards. The queue surfaces only generic lifecycle states (pending /
 * recurring), so this stays a single neutral treatment rather than inventing
 * a per-state color encoding.
 */
export const JobStatePill = ({ label }: { label: string }) => (
  <span className="inline-flex items-center gap-1.5 rounded-full bg-muted/40 px-2 py-0.5 text-xs font-medium text-muted-foreground capitalize">
    <span className="size-1.5 rounded-full bg-muted-foreground/50" aria-hidden />
    {label}
  </span>
);
