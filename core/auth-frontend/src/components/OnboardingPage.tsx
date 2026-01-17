import React, { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { User, Lock, Mail, CheckCircle, AlertCircle } from "lucide-react";
import { usePluginClient } from "@checkstack/frontend-api";
import { AuthApi, authRoutes, passwordSchema } from "@checkstack/auth-common";
import { resolveRoute } from "@checkstack/common";
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
} from "@checkstack/ui";
import { useAuthClient } from "../lib/auth-client";

export const OnboardingPage = () => {
  const navigate = useNavigate();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>();
  const [success, setSuccess] = useState(false);
  const [validationErrors, setValidationErrors] = useState<string[]>([]);

  const authClient = usePluginClient(AuthApi);
  const completeOnboardingMutation =
    authClient.completeOnboarding.useMutation();
  const betterAuthClient = useAuthClient();

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

  // Validate password on change
  useEffect(() => {
    if (password) {
      const result = passwordSchema.safeParse(password);
      if (result.success) {
        setValidationErrors([]);
      } else {
        setValidationErrors(result.error.issues.map((issue) => issue.message));
      }
    } else {
      setValidationErrors([]);
    }
  }, [password]);

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
        error_ instanceof Error ? error_.message : "Failed to complete setup";
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
              <div className="h-4 bg-muted animate-pulse rounded" />
              <div className="h-10 bg-muted animate-pulse rounded" />
              <div className="h-10 bg-muted animate-pulse rounded" />
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
              {validationErrors.length > 0 && (
                <ul className="text-sm text-muted-foreground list-disc pl-5 space-y-1">
                  {validationErrors.map((validationError, i) => (
                    <li key={i} className="text-destructive">
                      {validationError}
                    </li>
                  ))}
                </ul>
              )}
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

            <div className="text-xs text-muted-foreground">
              Password must be at least 8 characters and contain:
              <ul className="list-disc pl-5 mt-1">
                <li>At least one uppercase letter</li>
                <li>At least one lowercase letter</li>
                <li>At least one number</li>
              </ul>
            </div>
          </CardContent>
          <CardFooter>
            <Button
              type="submit"
              className="w-full"
              disabled={
                loading ||
                validationErrors.length > 0 ||
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
