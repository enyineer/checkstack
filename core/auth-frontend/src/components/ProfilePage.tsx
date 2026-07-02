import React, { useState, useEffect } from "react";
import { useNavigate, Link } from "react-router-dom";
import {
  User,
  Mail,
  Key,
  ArrowLeft,
  CheckCircle,
  AlertCircle,
} from "lucide-react";
import { usePluginClient } from "@checkstack/frontend-api";
import { AuthApi, authRoutes } from "@checkstack/auth-common";
import { resolveRoute } from "@checkstack/common";
import {
  Button,
  Input,
  Label,
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
  usePerformance,
  cn,
} from "@checkstack/ui";
import { AuthLandingCard } from "./AuthLandingCard";
import { deriveInitial } from "./identity.logic";
import { useSessionContext } from "../lib/SessionProvider";

export const ProfilePage = () => {
  const navigate = useNavigate();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [originalName, setOriginalName] = useState("");
  const [originalEmail, setOriginalEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>();
  const [success, setSuccess] = useState(false);
  const [hasCredentialAccount, setHasCredentialAccount] = useState(false);

  const authClient = usePluginClient(AuthApi);
  const { isLowPower } = usePerformance();

  // The profile is a logged-in-only surface, but its route carries no access
  // rule (there is nothing role-specific about "my profile"). Resolve the
  // session first: guests are redirected to login instead of firing the
  // authenticated-only profile query into a guaranteed 401.
  const { data: session, isPending: sessionPending } = useSessionContext();
  const isAuthenticated = !!session?.user;

  useEffect(() => {
    if (!sessionPending && !isAuthenticated) {
      navigate(resolveRoute(authRoutes.routes.login));
    }
  }, [sessionPending, isAuthenticated, navigate]);

  // Fetch current user profile (only once we know a user is signed in)
  const { data: profile, isLoading: loadingProfile } =
    authClient.getCurrentUserProfile.useQuery(
      {},
      { enabled: isAuthenticated },
    );

  // Update mutation
  const updateMutation = authClient.updateCurrentUser.useMutation({
    onSuccess: () => {
      setSuccess(true);
      setOriginalName(name);
      setOriginalEmail(email);
      setTimeout(() => setSuccess(false), 3000);
    },
    onError: (err) => {
      setError(err.message);
    },
  });

  // Populate form when profile loads
  useEffect(() => {
    if (profile) {
      setName(profile.name);
      setEmail(profile.email);
      setOriginalName(profile.name);
      setOriginalEmail(profile.email);
      setHasCredentialAccount(profile.hasCredentialAccount);
    }
  }, [profile]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(undefined);
    setLoading(true);

    try {
      const updates: { name?: string; email?: string } = {};
      if (name !== originalName) updates.name = name;
      if (email !== originalEmail && hasCredentialAccount)
        updates.email = email;

      // Only call if there are changes
      if (Object.keys(updates).length > 0) {
        await updateMutation.mutateAsync(updates);
      } else {
        setSuccess(true);
        setTimeout(() => setSuccess(false), 3000);
      }
    } catch {
      // Error handled by mutation
    } finally {
      setLoading(false);
    }
  };

  const hasChanges =
    name !== originalName || (hasCredentialAccount && email !== originalEmail);

  // Loading state — also shown while the session resolves (or briefly for a
  // guest before the login redirect above kicks in).
  if (sessionPending || !isAuthenticated || loadingProfile) {
    return (
      <div className="min-h-[80vh] flex items-center justify-center">
        <AuthLandingCard>
          <CardContent className="pt-6">
            <div className="space-y-4">
              <div
                className={cn(
                  "h-4 bg-muted rounded",
                  !isLowPower && "animate-pulse",
                )}
              />
              <div
                className={cn(
                  "h-10 bg-muted rounded",
                  !isLowPower && "animate-pulse",
                )}
              />
              <div
                className={cn(
                  "h-10 bg-muted rounded",
                  !isLowPower && "animate-pulse",
                )}
              />
            </div>
          </CardContent>
        </AuthLandingCard>
      </div>
    );
  }

  return (
    <div className="min-h-[80vh] flex items-center justify-center">
      <AuthLandingCard>
        <CardHeader className="space-y-1">
          <div className="flex items-center gap-3">
            <span
              className="grid size-12 shrink-0 place-items-center rounded-full bg-surface-inset text-base font-semibold text-muted-foreground"
              aria-hidden
            >
              {deriveInitial({ name, email })}
            </span>
            <div className="min-w-0">
              <CardTitle className="text-2xl font-bold">Profile</CardTitle>
              {email && (
                <p className="truncate text-xs text-muted-foreground">
                  {email}
                </p>
              )}
            </div>
          </div>
          <CardDescription>Manage your account settings</CardDescription>
        </CardHeader>
        <form onSubmit={handleSubmit}>
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

            {success && (
              <Alert variant="success">
                <AlertIcon>
                  <CheckCircle className="h-4 w-4" />
                </AlertIcon>
                <AlertContent>
                  <AlertTitle>Success</AlertTitle>
                  <AlertDescription>
                    Profile updated successfully
                  </AlertDescription>
                </AlertContent>
              </Alert>
            )}

            <div className="space-y-2">
              <Label htmlFor="name">Name</Label>
              <div className="relative">
                <User className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  id="name"
                  type="text"
                  placeholder="Your name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="pl-10"
                  required
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="email">Email</Label>
              <div className="relative">
                <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  id="email"
                  type="email"
                  placeholder="your@email.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="pl-10"
                  disabled={!hasCredentialAccount}
                  required
                />
              </div>
              {!hasCredentialAccount && (
                <p className="text-xs text-muted-foreground">
                  Email is managed by your social login provider
                </p>
              )}
            </div>

            {hasCredentialAccount && (
              <div className="pt-2">
                <Link
                  to={resolveRoute(authRoutes.routes.changePassword)}
                  className="inline-flex items-center gap-2 rounded-md border border-border/70 bg-surface-inset/40 px-3 py-2 text-sm text-primary transition-colors hover:border-primary/40"
                >
                  <Key className="h-4 w-4" />
                  Change Password
                </Link>
              </div>
            )}
          </CardContent>
          <CardFooter className="flex flex-col gap-4">
            <Button
              type="submit"
              className="w-full"
              disabled={loading || !hasChanges}
            >
              {loading ? "Saving..." : "Save Changes"}
            </Button>
            <button
              type="button"
              onClick={() => navigate(-1)}
              className="text-sm text-primary hover:underline flex items-center justify-center gap-1"
            >
              <ArrowLeft className="h-4 w-4" />
              Go Back
            </button>
          </CardFooter>
        </form>
      </AuthLandingCard>
    </div>
  );
};
