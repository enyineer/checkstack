import React, { useState, useEffect } from "react";
import { Link, useSearchParams, useNavigate } from "react-router-dom";
import { Lock, ArrowLeft, CheckCircle, AlertCircle } from "lucide-react";
import { AuthApi, authRoutes, passwordSchema } from "@checkstack/auth-common";
import { resolveRoute, extractErrorMessage} from "@checkstack/common";
import { usePluginClient } from "@checkstack/frontend-api";
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
  LoadingSpinner,
} from "@checkstack/ui";
import { getAuthClientLazy } from "../lib/auth-client";

export const ResetPasswordPage = () => {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const token = searchParams.get("token");

  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>();
  const [success, setSuccess] = useState(false);
  const [validationErrors, setValidationErrors] = useState<string[]>([]);
  const authClient = getAuthClientLazy();
  const authApiClient = usePluginClient(AuthApi);

  // Pre-validate token on load so users see invalid/expired errors before
  // entering a password. Token entropy is high enough that exposing validity
  // does not enable enumeration.
  const { data: tokenValidation, isLoading: validatingToken } =
    authApiClient.validateResetToken.useQuery(
      { token: token ?? "" },
      { enabled: Boolean(token) },
    );

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

    // Frontend validation
    if (password !== confirmPassword) {
      setError("Passwords do not match");
      return;
    }

    const result = passwordSchema.safeParse(password);
    if (!result.success) {
      setError(result.error.issues[0].message);
      return;
    }

    if (!token) {
      setError("Invalid or missing reset token");
      return;
    }

    setLoading(true);
    try {
      const response = await authClient.resetPassword({
        newPassword: password,
        token,
      });

      if (response.error) {
        setError(response.error.message ?? "Failed to reset password");
      } else {
        setSuccess(true);
      }
    } catch (error_) {
      setError(
        extractErrorMessage(error_, "Failed to reset password")
      );
    } finally {
      setLoading(false);
    }
  };

  // No token, expired, or invalid - show error before user types a password.
  const tokenInvalid =
    !token || (tokenValidation && !tokenValidation.valid);
  if (tokenInvalid) {
    const isExpired = tokenValidation?.reason === "expired";
    return (
      <div className="min-h-[80vh] flex items-center justify-center">
        <Card className="w-full max-w-md">
          <CardHeader className="space-y-1 text-center">
            <div className="mx-auto w-12 h-12 rounded-full bg-destructive/10 flex items-center justify-center mb-2">
              <AlertCircle className="h-6 w-6 text-destructive" />
            </div>
            <CardTitle className="text-2xl font-bold">
              {isExpired ? "Link Expired" : "Invalid Link"}
            </CardTitle>
            <CardDescription>
              {isExpired
                ? "This password reset link has expired. Please request a new one."
                : "This password reset link is invalid. Please request a new one."}
            </CardDescription>
          </CardHeader>
          <CardFooter className="flex flex-col gap-4">
            <Button
              variant="primary"
              className="w-full"
              onClick={() =>
                navigate(resolveRoute(authRoutes.routes.forgotPassword))
              }
            >
              Request New Link
            </Button>
            <Link
              to={resolveRoute(authRoutes.routes.login)}
              className="text-sm text-primary hover:underline flex items-center justify-center gap-1"
            >
              <ArrowLeft className="h-4 w-4" />
              Back to Login
            </Link>
          </CardFooter>
        </Card>
      </div>
    );
  }

  // While the token is being checked, show a spinner to avoid a flash of the
  // password form before we know whether the link is valid.
  if (validatingToken) {
    return (
      <div className="min-h-[80vh] flex items-center justify-center">
        <LoadingSpinner />
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
              Password Reset Successfully
            </CardTitle>
            <CardDescription>
              Your password has been reset. You can now log in with your new
              password.
            </CardDescription>
          </CardHeader>
          <CardFooter>
            <Button
              className="w-full"
              onClick={() => navigate(resolveRoute(authRoutes.routes.login))}
            >
              Go to Login
            </Button>
          </CardFooter>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-[80vh] flex items-center justify-center">
      <Card className="w-full max-w-md">
        <CardHeader className="space-y-1">
          <CardTitle className="text-2xl font-bold">Reset Password</CardTitle>
          <CardDescription>Enter your new password below.</CardDescription>
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
              <Label htmlFor="password">New Password</Label>
              <div className="relative">
                <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  id="password"
                  type="password"
                  placeholder="Enter new password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="pl-10"
                  required
                  autoFocus
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
                  placeholder="Confirm new password"
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
          <CardFooter className="flex flex-col gap-4">
            <Button
              type="submit"
              className="w-full"
              disabled={
                loading ||
                validationErrors.length > 0 ||
                password !== confirmPassword
              }
            >
              {loading ? "Resetting..." : "Reset Password"}
            </Button>
            <Link
              to={resolveRoute(authRoutes.routes.login)}
              className="text-sm text-primary hover:underline flex items-center justify-center gap-1"
            >
              <ArrowLeft className="h-4 w-4" />
              Back to Login
            </Link>
          </CardFooter>
        </form>
      </Card>
    </div>
  );
};
