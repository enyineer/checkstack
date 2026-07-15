import { useState, type ReactNode } from "react";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
  CardFooter,
  Button,
  useInitOnceForKey,
} from "@checkstack/ui";
import {
  StreamSystemLinksEditor,
  type StreamSystemSuggestions,
} from "./StreamSystemLinksEditor";
import { isLinksDraftDirty } from "./stream-system-links-card.logic";

export interface StreamSystemLinksSettingsCardProps {
  /**
   * Seed-once discriminator (the stream id). The draft is seeded from
   * `savedSystemIds` exactly once per key and is NOT reset by background
   * refetches of the same stream - see {@link useInitOnceForKey}. Load the
   * links query with `gcTime: 0` so a stale-while-revalidate entry cannot race
   * the one-shot seed.
   */
  streamKey: string;
  /**
   * The stream's currently-saved linked system ids, or `undefined` while the
   * links query is still loading. Save stays disabled until this resolves.
   */
  savedSystemIds: string[] | undefined;
  /** Persist the new full link set. The caller owns the gated mutation. */
  onSave: (systemIds: string[]) => void;
  /** True while the caller's save mutation is in flight. */
  saving: boolean;
  /**
   * Whether the caller may manage links (the gated mutation's `allowed`). When
   * false the editor is read-only and the Save footer is hidden.
   */
  canManage: boolean;
  /** Observed `service.name` values feeding the editor's suggestion chips. */
  suggestions?: StreamSystemSuggestions;
  /** Card title. Defaults to "Linked systems". */
  title?: string;
  /** Card description copy (plugin-specific wording for what the links mean). */
  description: ReactNode;
}

/**
 * Shared "Linked systems" settings card embedded by every stream plugin
 * (logstream / metricstream / tracestream) in its Settings tab. Owns the draft
 * + dirty + save-button semantics ONCE so the three tabs cannot drift: seeds a
 * local draft from `savedSystemIds` per `streamKey`, disables Save until the
 * draft actually differs from the saved set (order-insensitive), shows a
 * "Saving..." label while `saving`, and hides the Save footer entirely for
 * users who cannot manage. The plugin supplies the RPC (its gated
 * `setSystemLinks` mutation) via `onSave` / `saving` / `canManage`; this card
 * knows nothing plugin-specific beyond the copy in `description`.
 */
export function StreamSystemLinksSettingsCard({
  streamKey,
  savedSystemIds,
  onSave,
  saving,
  canManage,
  suggestions,
  title = "Linked systems",
  description,
}: StreamSystemLinksSettingsCardProps) {
  const [draft, setDraft] = useState<string[]>([]);
  useInitOnceForKey(savedSystemIds, streamKey, (ids) => setDraft(ids));

  const dirty = isLinksDraftDirty({ draft, saved: savedSystemIds });
  const disabled = !canManage || saving;

  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent>
        <StreamSystemLinksEditor
          value={draft}
          onChange={setDraft}
          disabled={disabled}
          suggestions={suggestions}
        />
      </CardContent>
      {canManage && (
        <CardFooter className="justify-end">
          <Button
            type="button"
            disabled={disabled || !dirty}
            onClick={() => onSave(draft)}
          >
            {saving ? "Saving…" : "Save linked systems"}
          </Button>
        </CardFooter>
      )}
    </Card>
  );
}
