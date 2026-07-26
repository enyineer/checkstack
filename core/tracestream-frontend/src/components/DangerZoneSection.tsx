import { useState } from "react";
import { useNavigate } from "react-router";
import { usePluginClient } from "@checkstack/frontend-api";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
  Button,
  ConfirmationModal,
  useToast,
  toastError,
} from "@checkstack/ui";
import { Trash2 } from "lucide-react";
import { TracestreamApi, type TraceStream } from "@checkstack/tracestream-common";

export interface DangerZoneSectionProps {
  stream: TraceStream;
}

/**
 * Settings "Danger zone": permanently delete the stream. Gated on the
 * contract-derived `deleteStream` verdict via `useGatedMutation`, so a
 * read-only viewer never sees the section. Deletion is irreversible (it
 * cascades every trace, span, bucket, token, service/operation stat and
 * important event), so it is guarded by a typed-name confirmation. On success
 * we navigate back to the streams list - the just-deleted detail route would
 * otherwise 404.
 */
export function DangerZoneSection({ stream }: DangerZoneSectionProps) {
  const client = usePluginClient(TracestreamApi);
  const navigate = useNavigate();
  const toast = useToast();
  const [confirmOpen, setConfirmOpen] = useState(false);

  const deleteMutation = client.deleteStream.useGatedMutation({
    gateInput: { id: stream.id },
    onSuccess: () => {
      toast.success("Stream deleted");
      navigate("/tracestream");
    },
    onError: (error) => toastError(toast, "Failed to delete stream", error),
  });

  // Hide the whole section from anyone who cannot delete this stream.
  if (!deleteMutation.allowed) return null;

  return (
    <Card className="border-destructive/40 bg-card">
      <CardHeader>
        <CardTitle className="text-destructive">Danger zone</CardTitle>
        <CardDescription>
          Deleting a stream permanently removes its traces, spans, aggregates,
          service stats and source tokens. Shippers using its tokens stop being
          authorized. This cannot be undone.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Button
          variant="destructive"
          onClick={() => setConfirmOpen(true)}
          disabled={deleteMutation.isPending}
        >
          <Trash2 className="size-4" />
          Delete stream
        </Button>
      </CardContent>

      <ConfirmationModal
        isOpen={confirmOpen}
        onClose={() => setConfirmOpen(false)}
        onConfirm={() => deleteMutation.mutate({ id: stream.id })}
        title={`Delete ${stream.name}`}
        message={
          <>
            This permanently deletes <strong>{stream.name}</strong> and every
            trace, span, aggregate, service stat and source token it owns. This
            action cannot be undone.
          </>
        }
        confirmPhrase={stream.name}
        confirmPhraseLabel={
          <>
            Type <strong>{stream.name}</strong> to confirm:
          </>
        }
        confirmText="Delete stream"
        variant="danger"
        isLoading={deleteMutation.isPending}
      />
    </Card>
  );
}
