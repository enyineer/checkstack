import { ShieldOff } from "lucide-react";

/**
 * Card-framed denial state for the infrastructure settings shell. A denied
 * read is a real signal, so the icon earns one restrained status hue seated in
 * a soft circular chip, and the whole thing is framed in a depth-aware panel
 * consistent with the rest of the design system — rather than an orphaned glyph
 * floating in the page.
 */
export const AccessDeniedCard = () => {
  return (
    <div className="flex items-center justify-center py-12">
      <div className="flex max-w-sm flex-col items-center gap-4 rounded-[var(--d-card-r)] border border-border/70 bg-gradient-to-b from-surface-2 to-surface p-[var(--d-pad)] text-center shadow-[0_1px_2px_hsl(var(--foreground)/0.04),0_10px_30px_-14px_hsl(var(--foreground)/0.12)]">
        <span className="flex size-12 items-center justify-center rounded-full bg-status-warn/10 text-status-warn">
          <ShieldOff className="size-6" />
        </span>
        <p className="text-lg font-medium text-foreground">Access Denied</p>
        <p className="text-sm text-muted-foreground">
          You don&apos;t have permission to view any infrastructure settings.
        </p>
      </div>
    </div>
  );
};
