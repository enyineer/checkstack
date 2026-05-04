import { useState } from "react";
import { ExternalLink, Plus, Trash2 } from "lucide-react";
import { Button } from "./Button";
import { Input } from "./Input";
import { Label } from "./Label";

export interface HotLink {
  id: string;
  label: string | null;
  url: string;
}

export interface LinksEditorProps<T extends HotLink> {
  /** Currently attached links. */
  links: T[];
  /** Whether the current user is allowed to add/remove links. */
  canManage?: boolean;
  /** Called when the user submits a new link. Should resolve when persisted. */
  onAdd: (props: { label?: string; url: string }) => Promise<void> | void;
  /** Called when the user removes a link. */
  onRemove: (link: T) => Promise<void> | void;
  /** Whether an add or remove mutation is currently in flight. */
  busy?: boolean;
  /** Heading shown above the list. Defaults to "Hotlinks". */
  title?: string;
  /** Help text under the heading. */
  description?: string;
}

/**
 * Inline editor for a list of free-form URL "hotlinks" (e.g. Jira tickets,
 * dashboards, runbooks). Used by the incident, maintenance, and catalog
 * plugins — the parent owns the data + mutation wiring; this component is
 * pure presentation.
 */
export function LinksEditor<T extends HotLink>({
  links,
  canManage = true,
  onAdd,
  onRemove,
  busy,
  title = "Hotlinks",
  description,
}: LinksEditorProps<T>) {
  const [label, setLabel] = useState("");
  const [url, setUrl] = useState("");
  const [error, setError] = useState<string | undefined>();

  const handleAdd = async () => {
    const trimmedUrl = url.trim();
    if (!trimmedUrl) {
      setError("URL is required");
      return;
    }
    try {
      // Triggers a synchronous URL parse error early so users get a clear
      // message instead of waiting for the server validation roundtrip.
      new URL(trimmedUrl);
    } catch {
      setError("Must be a valid URL (include http:// or https://)");
      return;
    }
    setError(undefined);
    await onAdd({ label: label.trim() || undefined, url: trimmedUrl });
    setLabel("");
    setUrl("");
  };

  return (
    <div className="space-y-3">
      <div>
        <Label>{title}</Label>
        {description && (
          <p className="text-xs text-muted-foreground mt-1">{description}</p>
        )}
      </div>

      {links.length > 0 ? (
        <div className="border rounded-lg divide-y">
          {links.map((link) => (
            <div
              key={link.id}
              className="flex items-center justify-between p-3 gap-2"
            >
              <div className="flex items-center gap-2 min-w-0 flex-1">
                <ExternalLink className="h-4 w-4 text-muted-foreground shrink-0" />
                <div className="min-w-0">
                  <a
                    href={link.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-sm text-primary hover:underline truncate block"
                  >
                    {link.label ?? link.url}
                  </a>
                  {link.label && (
                    <span className="text-xs text-muted-foreground truncate block">
                      {link.url}
                    </span>
                  )}
                </div>
              </div>
              {canManage && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => void onRemove(link)}
                  disabled={busy}
                  aria-label="Remove link"
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              )}
            </div>
          ))}
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">No links attached</p>
      )}

      {canManage && (
        <div className="border rounded-lg p-4 space-y-3">
          <div className="grid sm:grid-cols-[1fr_2fr] gap-3">
            <div className="space-y-1">
              <Label htmlFor="hotlink-label">Label (optional)</Label>
              <Input
                id="hotlink-label"
                placeholder="e.g. Jira ticket"
                value={label}
                onChange={(e) => setLabel(e.target.value)}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="hotlink-url">URL</Label>
              <Input
                id="hotlink-url"
                placeholder="https://example.com/..."
                value={url}
                onChange={(e) => setUrl(e.target.value)}
              />
            </div>
          </div>
          {error && <p className="text-xs text-destructive">{error}</p>}
          <Button
            onClick={() => void handleAdd()}
            disabled={!url.trim() || busy}
            size="sm"
          >
            <Plus className="h-4 w-4 mr-1" />
            Add Link
          </Button>
        </div>
      )}
    </div>
  );
}
