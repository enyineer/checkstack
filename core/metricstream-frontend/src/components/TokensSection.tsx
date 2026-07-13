import { useState } from "react";
import { usePluginClient } from "@checkstack/frontend-api";
import {
  Card,
  CardHeader,
  CardHeaderRow,
  CardTitle,
  CardDescription,
  CardContent,
  Button,
  Badge,
  ConfirmationModal,
  Skeleton,
  EmptyState,
  useToast,
  toastError,
  formatRelativeTime,
} from "@checkstack/ui";
import { KeyRound, Plus, Trash2 } from "lucide-react";
import {
  MetricstreamApi,
  type MetricStreamToken,
} from "@checkstack/metricstream-common";
import { MintTokenDialog } from "./MintTokenDialog";

export interface TokensSectionProps {
  streamId: string;
  canManage: boolean;
  onMinted?: (secret: string) => void;
}

/** Source-token management: list, mint (secret shown once) and revoke. */
export function TokensSection({
  streamId,
  canManage,
  onMinted,
}: TokensSectionProps) {
  const client = usePluginClient(MetricstreamApi);
  const toast = useToast();
  const [mintOpen, setMintOpen] = useState(false);
  const [revokeTarget, setRevokeTarget] = useState<MetricStreamToken | null>(
    null,
  );

  const { data: tokens, isLoading } = client.listTokens.useQuery({ streamId });

  const revokeMutation = client.revokeToken.useGatedMutation({
    gateInput: { streamId },
    onSuccess: () => {
      toast.success("Token revoked");
      setRevokeTarget(null);
    },
    onError: (error) => toastError(toast, "Failed to revoke token", error),
  });

  const active = (tokens ?? []).filter((t) => t.revokedAt === null);
  const revoked = (tokens ?? []).filter((t) => t.revokedAt !== null);

  return (
    <Card>
      <CardHeader>
        <CardHeaderRow>
          <div>
            <CardTitle>Source tokens</CardTitle>
            <CardDescription>
              Each token grants ingest access to this stream. Revoke a token to
              cut off a compromised shipper.
            </CardDescription>
          </div>
          {canManage && (
            <Button onClick={() => setMintOpen(true)}>
              <Plus className="size-4" />
              Mint token
            </Button>
          )}
        </CardHeaderRow>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="space-y-2" aria-busy="true">
            <Skeleton variant="row" />
            <Skeleton variant="row" />
          </div>
        ) : active.length === 0 && revoked.length === 0 ? (
          <EmptyState
            icon={<KeyRound className="h-6 w-6" />}
            title="No tokens yet"
            description="Mint a source token to start pushing metrics to this stream."
            actions={
              canManage ? (
                <Button onClick={() => setMintOpen(true)}>
                  <Plus className="size-4" />
                  Mint token
                </Button>
              ) : undefined
            }
          />
        ) : (
          <ul className="divide-y divide-border">
            {[...active, ...revoked].map((token) => {
              const isRevoked = token.revokedAt !== null;
              return (
                <li
                  key={token.id}
                  className="flex items-center justify-between gap-3 py-3"
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-foreground">
                        {token.name}
                      </span>
                      {isRevoked && <Badge variant="secondary">Revoked</Badge>}
                    </div>
                    <div className="mt-0.5 flex flex-wrap items-center gap-x-3 text-xs text-muted-foreground">
                      <code className="font-mono">{token.tokenPrefix}...</code>
                      <span>
                        {token.lastUsedAt
                          ? `Last used ${formatRelativeTime(token.lastUsedAt)}`
                          : "Never used"}
                      </span>
                    </div>
                  </div>
                  {canManage && !isRevoked && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setRevokeTarget(token)}
                    >
                      <Trash2 className="size-4" />
                      Revoke
                    </Button>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>

      <MintTokenDialog
        streamId={streamId}
        open={mintOpen}
        onOpenChange={setMintOpen}
        onMinted={onMinted}
      />

      <ConfirmationModal
        isOpen={revokeTarget !== null}
        onClose={() => setRevokeTarget(null)}
        onConfirm={() =>
          revokeTarget &&
          revokeMutation.mutate({ streamId, tokenId: revokeTarget.id })
        }
        title="Revoke token"
        message={
          <>
            Revoke <strong>{revokeTarget?.name}</strong>? Any shipper using this
            token will immediately stop being able to send metrics. This cannot
            be undone.
          </>
        }
        confirmText="Revoke"
        variant="danger"
        isLoading={revokeMutation.isPending}
      />
    </Card>
  );
}
