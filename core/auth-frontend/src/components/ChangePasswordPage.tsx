import React, { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { Lock, ArrowLeft, CheckCircle, AlertCircle, Key } from "lucide-react";
import { passwordSchema } from "@checkmate-monitor/auth-common";
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
  Checkbox,
} from "@checkmate-monitor/ui";
import { useAuthClient } from "../lib/auth-client";

export const ChangePasswordPage = () => {
  const navigate = useNavigate();

  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [revokeOtherSessions, setRevokeOtherSessions] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>();
  const [success, setSuccess] = useState(false);
  const [validationErrors, setValidationErrors] = useState<string[]>([]);
  const authClient = useAuthClient();

  // Validate new password on change
  useEffect(() => {
    if (newPassword) {
      const result = passwordSchema.safeParse(newPassword);
      if (result.success) {
        setValidationErrors([]);
      } else {
        setValidationErrors(result.error.issues.map((issue) => issue.message));
      }
    } else {
      setValidationErrors([]);
    }
  }, [newPassword]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(undefined);

    // Frontend validation
    if (newPassword !== confirmPassword) {
      setError("New passwords do not match");
      return;
    }

    const result = passwordSchema.safeParse(newPassword);
    if (!result.success) {
      setError(result.error.issues[0].message);
      return;
    }

    if (!currentPassword) {
      setError("Current password is required");
      return;
    }

    setLoading(true);
    try {
      const response = await authClient.changePassword({
        currentPassword,
        newPassword,
        revokeOtherSessions,
      });

      if (response.error) {
        setError(response.error.message ?? "Failed to change password");
      } else {
        setSuccess(true);
      }
    } catch (error_) {
      setError(
        error_ instanceof Error ? error_.message : "Failed to change password"
      );
    } finally {
      setLoading(false);
    }
  };

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
              Password Changed Successfully
            </CardTitle>
            <CardDescription>
              Your password has been updated.
              {revokeOtherSessions &&
                " All other sessions have been signed out."}
            </CardDescription>
          </CardHeader>
          <CardFooter>
            <Button className="w-full" onClick={() => navigate("/")}>
              Go to Dashboard
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
          <CardTitle className="text-2xl font-bold">Change Password</CardTitle>
          <CardDescription>
            Enter your current password and choose a new password.
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
              <Label htmlFor="currentPassword">Current Password</Label>
              <div className="relative">
                <Key className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  id="currentPassword"
                  type="password"
                  placeholder="Enter current password"
                  value={currentPassword}
                  onChange={(e) => setCurrentPassword(e.target.value)}
                  className="pl-10"
                  required
                  autoFocus
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="newPassword">New Password</Label>
              <div className="relative">
                <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  id="newPassword"
                  type="password"
                  placeholder="Enter new password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
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
              <Label htmlFor="confirmPassword">Confirm New Password</Label>
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
              {confirmPassword && newPassword !== confirmPassword && (
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

            <div className="flex items-center space-x-2">
              <Checkbox
                id="revokeOtherSessions"
                checked={revokeOtherSessions}
                onCheckedChange={(checked) =>
                  setRevokeOtherSessions(checked === true)
                }
              />
              <Label
                htmlFor="revokeOtherSessions"
                className="text-sm font-normal"
              >
                Sign out of all other sessions
              </Label>
            </div>
          </CardContent>
          <CardFooter className="flex flex-col gap-4">
            <Button
              type="submit"
              className="w-full"
              disabled={
                loading ||
                validationErrors.length > 0 ||
                newPassword !== confirmPassword ||
                !currentPassword
              }
            >
              {loading ? "Changing..." : "Change Password"}
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
      </Card>
    </div>
  );
};
