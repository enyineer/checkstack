import { Mail, ExternalLink, Package } from "lucide-react";
import {
  usePerformance,
  cn,
  GithubIcon as Github,
} from "@checkstack/ui";

/**
 * The page's single hero moment: a premium masthead panel with depth, a
 * gradient icon chip, and one restrained aurora flourish behind the content.
 *
 * The aurora blob is purely decorative (aria-hidden, pointer-events-none) and
 * is dropped on low-power devices in favor of a solid surface, per the
 * performance rule. No href targets or link text change.
 */
export function AboutHero() {
  const { isLowPower } = usePerformance();

  return (
    <div
      className={cn(
        "relative overflow-hidden rounded-[var(--d-card-r)] border border-border/70 p-[var(--d-pad)]",
        "shadow-[0_1px_2px_hsl(var(--foreground)/0.04),0_10px_30px_-14px_hsl(var(--foreground)/0.12)]",
        isLowPower
          ? "bg-surface-2"
          : "bg-gradient-to-b from-surface-2 to-surface",
      )}
    >
      {/* Restrained aurora flourish, anchored top-right behind the content. */}
      {!isLowPower && (
        <span
          aria-hidden
          className="pointer-events-none absolute -right-16 -top-24 size-64 rounded-full bg-primary/20 blur-3xl"
        />
      )}

      <div className="relative">
        <div className="flex items-start gap-4">
          <div className="flex size-14 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-primary/15 to-primary/5 ring-1 ring-primary/20">
            <Package className="size-8 text-primary" />
          </div>
          <div className="min-w-0 space-y-1">
            <h3 className="text-2xl font-bold leading-tight text-foreground">
              Checkstack
            </h3>
            <p className="text-sm text-muted-foreground">
              The Modern Status Page &amp; Monitoring Platform
            </p>
          </div>
        </div>

        <p className="mt-4 max-w-2xl text-sm leading-relaxed text-muted-foreground">
          Monitor your systems, keep users informed, and maintain trust.
          Checkstack combines the power of a status page, uptime monitoring, and
          incident management into a single, extensible platform.
        </p>

        <div className="mt-5 flex flex-wrap gap-3">
          <a
            href="https://github.com/enyineer/checkstack"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 rounded-lg border border-border/70 bg-surface-inset px-4 py-2 text-sm font-medium text-foreground transition-all hover:-translate-y-0.5 hover:border-primary/40"
          >
            <Github className="size-4" />
            GitHub Repository
            <ExternalLink className="size-3 text-muted-foreground" />
          </a>
          <a
            href="mailto:hi@enking.dev"
            className="inline-flex items-center gap-2 rounded-lg border border-border/70 bg-surface-inset px-4 py-2 text-sm font-medium text-foreground transition-all hover:-translate-y-0.5 hover:border-primary/40"
          >
            <Mail className="size-4" />
            hi@enking.dev
          </a>
        </div>
      </div>
    </div>
  );
}
