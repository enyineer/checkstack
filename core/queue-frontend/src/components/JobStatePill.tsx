import { StatusPill } from "@checkstack/ui";

/**
 * A job's State in the jobs table and mobile cards.
 *
 * The queue surfaces only generic lifecycle states (pending / recurring), none
 * of which is good or bad, so this stays the shared NEUTRAL pill rather than
 * inventing a per-state colour encoding. It used to hand-roll the chip at a
 * softer opacity than the shared neutral, which made the same "carries no
 * signal" idea look like two different things on one page.
 */
export const JobStatePill = ({ label }: { label: string }) => (
  <StatusPill tone="neutral" size="sm" className="capitalize">
    {label}
  </StatusPill>
);
