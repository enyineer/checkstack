import React, { useState, useEffect, useMemo } from "react";
import { useNavigate } from "react-router";
import { User, Lock, Mail, CheckCircle, AlertCircle, Check } from "lucide-react";
import { usePluginClient } from "@checkstack/frontend-api";
import {
  AuthApi,
  authRoutes,
  passwordSchema,
  evaluatePasswordCriteria,
} from "@checkstack/auth-common";
import { resolveRoute, extractErrorMessage} from "@checkstack/common";
import {
  Button,
  Input,
  Label,
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
  usePerformance,
  cn,
} from "@checkstack/ui";
import { getAuthClientLazy } from "../lib/auth-client";

export const OnboardingPage = () => {
  const navigate = useNavigate();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>();
  const [success, setSuccess] = useState(false);

  // Live, per-criterion password feedback bound to the shared password schema's
  // rules: each requirement ticks green as the user types instead of only
  // surfacing as a destructive list on submit. `passwordValid` mirrors
  // `passwordSchema.safeParse(...).success` (the criteria are in lock-step with
  // the schema) and gates the submit button.
  const passwordCriteria = useMemo(
    () => evaluatePasswordCriteria(password),
    [password],
  );
  const passwordValid = useMemo(
    () => passwordCriteria.every((criterion) => criterion.met),
    [passwordCriteria],
  );

  const authClient = usePluginClient(AuthApi);
  const completeOnboardingMutation =
    authClient.completeOnboarding.useMutation();
  const betterAuthClient = getAuthClientLazy();
  const { isLowPower } = usePerformance();

  // Check if onboarding is needed
  const { data: onboardingStatus, isLoading: checkingStatus } =
    authClient.getOnboardingStatus.useQuery({});

  // Redirect if onboarding not needed
  useEffect(() => {
    if (
      !checkingStatus &&
      onboardingStatus &&
      !onboardingStatus.needsOnboarding
    ) {
      navigate(resolveRoute(authRoutes.routes.login));
    }
  }, [checkingStatus, onboardingStatus, navigate]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(undefined);

    // Validate password match
    if (password !== confirmPassword) {
      setError("Passwords do not match");
      return;
    }

    // Validate password strength
    const result = passwordSchema.safeParse(password);
    if (!result.success) {
      setError(result.error.issues[0].message);
      return;
    }

    setLoading(true);
    try {
      const response = await completeOnboardingMutation.mutateAsync({
        name,
        email,
        password,
      });

      if (response.success) {
        // Auto-login the user
        const loginRes = await betterAuthClient.signIn.email({
          email,
          password,
        });

        if (loginRes.error) {
          setError("Account created but login failed. Please login manually.");
        } else {
          setSuccess(true);
          // Redirect to dashboard
          setTimeout(() => {
            globalThis.location.href = "/";
          }, 1500);
        }
      }
    } catch (error_) {
      const message =
        extractErrorMessage(error_, "Failed to complete setup");
      setError(message);
    } finally {
      setLoading(false);
    }
  };

  // Loading state
  if (checkingStatus) {
    return (
      <div className="min-h-[80vh] flex items-center justify-center">
        <Card className="w-full max-w-md">
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
        </Card>
      </div>
    );
  }

  // Success state
  if (success) {
    return (
      <div className="min-h-[80vh] flex items-center justify-center">
        <Card className="w-full max-w-md">
          <CardHeader className="space-y-1 text-center">
            <div className="mx-auto w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center mb-2">
              <CheckCircle className="h-6 w-6 text-primary" />
            </div>
            <CardTitle className="text-2xl font-bold">
              Setup Complete!
            </CardTitle>
            <CardDescription>
              Your admin account has been created. Redirecting to dashboard...
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
          <CardTitle className="text-2xl font-bold">
            Welcome to Checkstack
          </CardTitle>
          <CardDescription>
            Create your administrator account to get started
          </CardDescription>
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
                  autoFocus
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
                  placeholder="admin@example.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="pl-10"
                  required
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="password">Password</Label>
              <div className="relative">
                <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  id="password"
                  type="password"
                  placeholder="Create a strong password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="pl-10"
                  required
                />
              </div>
              <ul className="space-y-1 pt-1">
                {passwordCriteria.map((criterion) => (
                  <li
                    key={criterion.id}
                    className={cn(
                      "flex items-center gap-2 text-sm transition-colors",
                      criterion.met
                        ? "text-success"
                        : "text-muted-foreground",
                    )}
                  >
                    <span
                      className={cn(
                        "flex h-4 w-4 shrink-0 items-center justify-center rounded-full border",
                        criterion.met
                          ? "border-success bg-success/10"
                          : "border-muted-foreground/40",
                      )}
                      aria-hidden="true"
                    >
                      {criterion.met ? <Check className="h-3 w-3" /> : null}
                    </span>
                    <span>{criterion.label}</span>
                  </li>
                ))}
              </ul>
            </div>

            <div className="space-y-2">
              <Label htmlFor="confirmPassword">Confirm Password</Label>
              <div className="relative">
                <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  id="confirmPassword"
                  type="password"
                  placeholder="Confirm your password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  className="pl-10"
                  required
                />
              </div>
              {confirmPassword && password !== confirmPassword && (
                <p className="text-sm text-destructive">
                  Passwords do not match
                </p>
              )}
            </div>

          </CardContent>
          <CardFooter>
            <Button
              type="submit"
              className="w-full"
              disabled={
                loading ||
                !passwordValid ||
                password !== confirmPassword ||
                !name ||
                !email
              }
            >
              {loading ? "Creating Account..." : "Complete Setup"}
            </Button>
          </CardFooter>
        </form>
      </Card>
    </div>
  );
};
