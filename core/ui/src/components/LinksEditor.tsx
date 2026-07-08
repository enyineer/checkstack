import { useState } from "react";
import type { ReactNode } from "react";
import { ExternalLink, Plus, Trash2, Pencil } from "lucide-react";
import { Button } from "./Button";
import { Input } from "./Input";
import { Label } from "./Label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "./Select";

export interface HotLink {
  id: string;
  label: string | null;
  url: string;
  /**
   * Optional audience for the link. Only meaningful when the parent passes the
   * `visibility` prop (e.g. incident / maintenance links). Left generic so the
   * catalog usage - which has no visibility concept - is unaffected.
   */
  visibility?: string;
}

/**
 * Optional visibility control for the links editor. When supplied, the add form
 * gains an audience select and each row renders a badge for its visibility. The
 * owning plugin owns the option set and the badge presentation.
 */
export interface LinksEditorVisibility {
  options: { value: string; label: string }[];
  /** Default selected value for a newly-added link. */
  default: string;
  /** Renders a per-row badge for a link's visibility (lock / eye chip). */
  renderBadge?: (visibility: string) => ReactNode;
}

// Parse a user-supplied URL and return its canonicalized form ONLY when the
// scheme is `http:` / `https:`. Returns `undefined` for any other scheme
// (`javascript:`, `data:`, `vbscript:`, etc.) so callers can refuse to
// render an anchor at all. The returned string is `URL.toString()` — i.e.
// a re-serialized URL — so taint analysis sees a fresh, sanitized value
// rather than the raw input flowing through. CodeQL js/xss-through-dom.
function safeHref(raw: string): string | undefined {
  try {
    const parsed = new URL(raw);
    if (parsed.protocol === "http:" || parsed.protocol === "https:") {
      return parsed.toString();
    }
    return undefined;
  } catch {
    return undefined;
  }
}

export interface LinksEditorProps<T extends HotLink> {
  /** Currently attached links. */
  links: T[];
  /** Whether the current user is allowed to add/remove links. */
  canManage?: boolean;
  /** Called when the user submits a new link. Should resolve when persisted. */
  onAdd: (props: {
    label?: string;
    url: string;
    visibility?: string;
  }) => Promise<void> | void;
  /**
   * Optional: called when the user saves edits to an existing link. When
   * supplied, each row gains an inline "edit" affordance (label / URL, plus
   * visibility when the `visibility` prop is set). Omit to keep links
   * add/remove-only.
   */
  onEdit?: (props: {
    id: string;
    label?: string;
    url: string;
    visibility?: string;
  }) => Promise<void> | void;
  /** Called when the user removes a link. */
  onRemove: (link: T) => Promise<void> | void;
  /** Whether an add or remove mutation is currently in flight. */
  busy?: boolean;
  /** Heading shown above the list. Defaults to "Hotlinks". */
  title?: string;
  /** Help text under the heading. */
  description?: string;
  /**
   * Opt-in per-link visibility control. Omit for surfaces (e.g. catalog) that
   * have no audience concept - the editor then behaves exactly as before.
   */
  visibility?: LinksEditorVisibility;
}

/**
 * Inline editor for a list of free-form URL "hotlinks" (e.g. Jira tickets,
 * dashboards, runbooks). Used by the incident, maintenance, and catalog
 * plugins — the parent owns the data + mutation wiring; this component is
 * pure presentation.
 */
// Validate a user-supplied URL, returning either the trimmed URL or an error
// message. Shared by the add form and the inline edit form so both refuse the
// same unsafe / malformed input before the server roundtrip.
function validateLinkUrl(raw: string): { url: string } | { error: string } {
  const trimmed = raw.trim();
  if (!trimmed) return { error: "URL is required" };
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return { error: "Must be a valid URL (include http:// or https://)" };
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return { error: "Only http:// and https:// URLs are allowed" };
  }
  return { url: trimmed };
}

export function LinksEditor<T extends HotLink>({
  links,
  canManage = true,
  onAdd,
  onEdit,
  onRemove,
  busy,
  title = "Hotlinks",
  description,
  visibility,
}: LinksEditorProps<T>) {
  const [label, setLabel] = useState("");
  const [url, setUrl] = useState("");
  const [linkVisibility, setLinkVisibility] = useState(
    visibility?.default ?? "",
  );
  const [error, setError] = useState<string | undefined>();

  // Inline edit state (only used when `onEdit` is supplied). `editingId` is the
  // link currently being edited; the edit-form fields mirror the add form.
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editLabel, setEditLabel] = useState("");
  const [editUrl, setEditUrl] = useState("");
  const [editVisibility, setEditVisibility] = useState("");
  const [editError, setEditError] = useState<string | undefined>();

  const beginEdit = (link: T) => {
    setEditingId(link.id);
    setEditLabel(link.label ?? "");
    setEditUrl(link.url);
    setEditVisibility(link.visibility ?? visibility?.default ?? "");
    setEditError(undefined);
  };

  const cancelEdit = () => {
    setEditingId(null);
    setEditError(undefined);
  };

  const handleSaveEdit = async () => {
    if (!onEdit || editingId === null) return;
    const result = validateLinkUrl(editUrl);
    if ("error" in result) {
      setEditError(result.error);
      return;
    }
    setEditError(undefined);
    await onEdit({
      id: editingId,
      label: editLabel.trim() || undefined,
      url: result.url,
      visibility: visibility ? editVisibility : undefined,
    });
    setEditingId(null);
  };

  const handleAdd = async () => {
    const result = validateLinkUrl(url);
    if ("error" in result) {
      setError(result.error);
      return;
    }
    setError(undefined);
    await onAdd({
      label: label.trim() || undefined,
      url: result.url,
      visibility: visibility ? linkVisibility : undefined,
    });
    setLabel("");
    setUrl("");
    setLinkVisibility(visibility?.default ?? "");
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
          {links.map((link) => {
            const href = safeHref(link.url);
            // Inline edit form for THIS link (only when onEdit is supplied and
            // the row is the one being edited).
            if (onEdit && canManage && editingId === link.id) {
              return (
                <div key={link.id} className="p-3 space-y-3">
                  <div className="grid sm:grid-cols-[1fr_2fr] gap-3">
                    <div className="space-y-1">
                      <Label htmlFor={`edit-label-${link.id}`}>
                        Label (optional)
                      </Label>
                      <Input
                        id={`edit-label-${link.id}`}
                        placeholder="e.g. Jira ticket"
                        value={editLabel}
                        onChange={(e) => setEditLabel(e.target.value)}
                      />
                    </div>
                    <div className="space-y-1">
                      <Label htmlFor={`edit-url-${link.id}`}>URL</Label>
                      <Input
                        id={`edit-url-${link.id}`}
                        placeholder="https://example.com/..."
                        value={editUrl}
                        onChange={(e) => setEditUrl(e.target.value)}
                      />
                    </div>
                  </div>
                  {visibility && (
                    <div className="space-y-1">
                      <Label htmlFor={`edit-visibility-${link.id}`}>
                        Visibility
                      </Label>
                      <Select
                        value={editVisibility}
                        onValueChange={setEditVisibility}
                      >
                        <SelectTrigger id={`edit-visibility-${link.id}`}>
                          <SelectValue placeholder="Select visibility" />
                        </SelectTrigger>
                        <SelectContent>
                          {visibility.options.map((opt) => (
                            <SelectItem key={opt.value} value={opt.value}>
                              {opt.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  )}
                  {editError && (
                    <p className="text-xs text-destructive">{editError}</p>
                  )}
                  <div className="flex gap-2 justify-end">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={cancelEdit}
                      disabled={busy}
                    >
                      Cancel
                    </Button>
                    <Button
                      size="sm"
                      onClick={() => void handleSaveEdit()}
                      disabled={!editUrl.trim() || busy}
                    >
                      Save
                    </Button>
                  </div>
                </div>
              );
            }
            return (
              <div
                key={link.id}
                className="flex items-center justify-between p-3 gap-2"
              >
                <div className="flex items-center gap-2 min-w-0 flex-1">
                  <ExternalLink className="h-4 w-4 text-muted-foreground shrink-0" />
                  <div className="min-w-0">
                    {href ? (
                      <a
                        href={href}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-sm text-primary hover:underline truncate block"
                      >
                        {link.label ?? link.url}
                      </a>
                    ) : (
                      <span
                        className="text-sm text-muted-foreground truncate block"
                        title="Unsafe URL scheme - link disabled"
                      >
                        {link.label ?? link.url}
                      </span>
                    )}
                    {link.label && (
                      <span className="text-xs text-muted-foreground truncate block">
                        {link.url}
                      </span>
                    )}
                  </div>
                </div>
                {visibility?.renderBadge && link.visibility && (
                  <div className="shrink-0">
                    {visibility.renderBadge(link.visibility)}
                  </div>
                )}
                {canManage && onEdit && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => beginEdit(link)}
                    disabled={busy}
                    aria-label="Edit link"
                  >
                    <Pencil className="h-4 w-4" />
                  </Button>
                )}
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
            );
          })}
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
          {visibility && (
            <div className="space-y-1">
              <Label htmlFor="hotlink-visibility">Visibility</Label>
              <Select
                value={linkVisibility}
                onValueChange={setLinkVisibility}
              >
                <SelectTrigger id="hotlink-visibility">
                  <SelectValue placeholder="Select visibility" />
                </SelectTrigger>
                <SelectContent>
                  {visibility.options.map((opt) => (
                    <SelectItem key={opt.value} value={opt.value}>
                      {opt.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
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
