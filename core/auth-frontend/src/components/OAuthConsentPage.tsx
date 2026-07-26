import { useState } from "react";
import { useSearchParams } from "react-router";
import { ShieldCheck, AlertCircle } from "lucide-react";
import { extractErrorMessage } from "@checkstack/common";
import { getCachedRuntimeConfig } from "@checkstack/frontend-api";
import {
  Button,
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
  CardFooter,
  Alert,
  AlertIcon,
  AlertContent,
  AlertTitle,
  AlertDescription,
  Badge,
} from "@checkstack/ui";

/**
 * OAuth 2.1 consent screen for the AI platform's Authorization Server.
 *
 * better-auth's `oidcProvider` redirects the interactive authorization-code
 * flow to `consentPage` (configured as `/auth/oauth-consent`) with the
 * `consent_code`, `client_id`, and granted `scope` as query params. Without a
 * route here the flow 404s; this minimal page renders the requested client and
 * scopes, then POSTs the user's decision to the better-auth consent endpoint
 * and follows the returned `redirectURI`.
 *
 * The decision endpoint requires the user's session cookie (it runs behind
 * `sessionMiddleware`), so the POST uses `credentials: "include"`.
 */
export const OAuthConsentPage = () => {
  const [searchParams] = useSearchParams();
  const consentCode = searchParams.get("consent_code");
  const clientId = searchParams.get("client_id");
  const scope = searchParams.get("scope") ?? "";

  const [loading, setLoading] = useState<"accept" | "deny" | undefined>();
  const [error, setError] = useState<string>();

  const baseUrl = getCachedRuntimeConfig()?.baseUrl ?? globalThis.location.origin;
  const scopes = scope.split(" ").filter(Boolean);

  const submit = async (accept: boolean) => {
    setError(undefined);
    setLoading(accept ? "accept" : "deny");
    try {
      const res = await fetch(`${baseUrl}/api/auth/oauth2/consent`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ accept, consent_code: consentCode }),
      });
      if (!res.ok) {
        let detail: string | undefined;
        try {
          const body = (await res.json()) as {
            error_description?: string;
            message?: string;
          };
          detail = body.error_description ?? body.message;
        } catch {
          // Non-JSON error body — fall back to the generic message below.
        }
        setError(
          detail ??
            "Consent could not be processed. The request may have expired.",
        );
        setLoading(undefined);
        return;
      }
      const data = (await res.json()) as { redirectURI?: string };
      if (data.redirectURI) {
        globalThis.location.href = data.redirectURI;
        return;
      }
      setError("The authorization server did not return a redirect.");
    } catch (error_) {
      setError(extractErrorMessage(error_, "Consent request failed."));
    } finally {
      setLoading(undefined);
    }
  };

  if (!consentCode || !clientId) {
    return (
      <div className="min-h-[80vh] flex items-center justify-center">
        <Card className="w-full max-w-md">
          <CardHeader className="space-y-1 text-center">
            <div className="mx-auto w-12 h-12 rounded-full bg-destructive/10 flex items-center justify-center mb-2">
              <AlertCircle className="h-6 w-6 text-destructive" />
            </div>
            <CardTitle className="text-2xl font-bold">Invalid Request</CardTitle>
            <CardDescription>
              This authorization request is missing required parameters. Start
              the connection again from your client application.
            </CardDescription>
          </CardHeader>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-[80vh] flex items-center justify-center">
      <Card className="w-full max-w-md">
        <CardHeader className="space-y-1 text-center">
          <div className="mx-auto w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center mb-2">
            <ShieldCheck className="h-6 w-6 text-primary" />
          </div>
          <CardTitle className="text-2xl font-bold">Authorize access</CardTitle>
          <CardDescription>
            <span className="font-medium text-foreground">{clientId}</span> is
            requesting access to your Checkstack account.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {error && (
            <Alert variant="error">
              <AlertIcon>
                <AlertCircle className="h-4 w-4" />
              </AlertIcon>
              <AlertContent>
                <AlertTitle>Error</AlertTitle>
                <AlertDescription>{error}</AlertDescription>
              </AlertContent>
            </Alert>
          )}

          <div className="space-y-2">
            <p className="text-sm text-muted-foreground">
              This application will be able to act on your behalf with the
              following scopes:
            </p>
            {scopes.length > 0 ? (
              <div className="flex flex-wrap gap-2">
                {scopes.map((s) => (
                  <Badge key={s} variant="secondary">
                    {s}
                  </Badge>
                ))}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground italic">
                No specific scopes requested.
              </p>
            )}
            <p className="text-xs text-muted-foreground pt-2">
              Access is always limited to what your own account already permits.
            </p>
          </div>
        </CardContent>
        <CardFooter className="flex gap-3">
          <Button
            variant="outline"
            className="flex-1"
            disabled={loading !== undefined}
            onClick={() => submit(false)}
          >
            {loading === "deny" ? "Denying..." : "Deny"}
          </Button>
          <Button
            variant="primary"
            className="flex-1"
            disabled={loading !== undefined}
            onClick={() => submit(true)}
          >
            {loading === "accept" ? "Authorizing..." : "Allow"}
          </Button>
        </CardFooter>
      </Card>
    </div>
  );
};
