import React, { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { AlertCircle } from "lucide-react";
import { useApi, rpcApiRef } from "@checkmate/frontend-api";
import { authApiRef } from "../api";
import type { AuthClient } from "@checkmate/auth-common";
import { authRoutes } from "@checkmate/auth-common";
import { resolveRoute } from "@checkmate/common";
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
  InfoBanner,
  InfoBannerIcon,
  InfoBannerContent,
  InfoBannerTitle,
  InfoBannerDescription,
} from "@checkmate/ui";
import { useEnabledStrategies } from "../hooks/useEnabledStrategies";
import { SocialProviderButton } from "./SocialProviderButton";
import { authClient } from "../lib/auth-client";
import { useEffect } from "react";

export const RegisterPage = () => {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();
  const authApi = useApi(authApiRef);
  const rpcApi = useApi(rpcApiRef);
  const authRpcClient = rpcApi.forPlugin<AuthClient>("auth");
  const { strategies, loading: strategiesLoading } = useEnabledStrategies();
  const [registrationAllowed, setRegistrationAllowed] = useState<boolean>(true);
  const [checkingRegistration, setCheckingRegistration] = useState(true);

  useEffect(() => {
    authRpcClient
      .getRegistrationStatus()
      .then(({ allowRegistration }) => {
        setRegistrationAllowed(allowRegistration);
      })
      .catch((error: Error) => {
        console.error("Failed to check registration status:", error);
        // Default to allowed on error to avoid blocking
        setRegistrationAllowed(true);
      })
      .finally(() => setCheckingRegistration(false));
  }, [authRpcClient]);

  const handleCredentialRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      const res = await authClient.signUp.email({ name, email, password });
      if (res.error) {
        console.error("Registration failed:", res.error);
      } else {
        navigate("/");
      }
    } catch (error) {
      console.error("Registration failed:", error);
    } finally {
      setLoading(false);
    }
  };

  const handleSocialRegister = async (provider: string) => {
    try {
      await authApi.signInWithSocial(provider);
      // Navigation will happen automatically after OAuth redirect
    } catch (error) {
      console.error("Social registration failed:", error);
    }
  };

  const credentialStrategy = strategies.find((s) => s.type === "credential");
  const socialStrategies = strategies.filter((s) => s.type === "social");
  const hasCredential = !!credentialStrategy;
  const hasSocial = socialStrategies.length > 0;

  // Loading state
  if (strategiesLoading || checkingRegistration) {
    return (
      <div className="min-h-[80vh] flex items-center justify-center">
        <Card className="w-full max-w-md">
          <CardContent className="pt-6">
            <div className="space-y-4">
              <div className="h-4 bg-muted animate-pulse rounded" />
              <div className="h-10 bg-muted animate-pulse rounded" />
              <div className="h-10 bg-muted animate-pulse rounded" />
              <div className="h-10 bg-muted animate-pulse rounded" />
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  // Registration is disabled
  if (!registrationAllowed) {
    return (
      <div className="min-h-[80vh] flex items-center justify-center">
        <Card className="w-full max-w-md">
          <CardHeader className="flex flex-col space-y-1 items-center">
            <CardTitle>Registration Disabled</CardTitle>
          </CardHeader>
          <CardContent>
            <InfoBanner variant="warning">
              <InfoBannerIcon>
                <AlertCircle className="h-4 w-4" />
              </InfoBannerIcon>
              <InfoBannerContent>
                <InfoBannerTitle>
                  Registration is Currently Disabled
                </InfoBannerTitle>
                <InfoBannerDescription>
                  New user registration has been disabled by the system
                  administrator. If you already have an account, please{" "}
                  <Link
                    to={resolveRoute(authRoutes.routes.login)}
                    className="underline text-primary hover:text-primary/90 font-medium"
                  >
                    sign in
                  </Link>
                  . Otherwise, please contact your administrator for assistance.
                </InfoBannerDescription>
              </InfoBannerContent>
            </InfoBanner>
          </CardContent>
        </Card>
      </div>
    );
  }

  // No strategies enabled
  if (strategies.length === 0) {
    return (
      <div className="min-h-[80vh] flex items-center justify-center">
        <Card className="w-full max-w-md">
          <CardHeader className="flex flex-col space-y-1 items-center">
            <CardTitle>Registration Unavailable</CardTitle>
          </CardHeader>
          <CardContent>
            <InfoBanner variant="warning">
              <InfoBannerIcon>
                <AlertCircle className="h-4 w-4" />
              </InfoBannerIcon>
              <InfoBannerContent>
                <InfoBannerTitle>
                  No authentication methods enabled
                </InfoBannerTitle>
                <InfoBannerDescription>
                  Please contact your system administrator to enable
                  authentication methods.
                </InfoBannerDescription>
              </InfoBannerContent>
            </InfoBanner>
          </CardContent>
        </Card>
      </div>
    );
  }

  // Check if any strategy requires manual registration
  const requiresRegistration = strategies.some(
    (s) => s.requiresManualRegistration
  );

  // If no strategy requires manual registration, inform the user
  if (!requiresRegistration) {
    return (
      <div className="min-h-[80vh] flex items-center justify-center">
        <Card className="w-full max-w-md">
          <CardHeader className="flex flex-col space-y-1 items-center">
            <CardTitle>Registration Not Required</CardTitle>
          </CardHeader>
          <CardContent>
            <InfoBanner>
              <InfoBannerIcon>
                <AlertCircle className="h-4 w-4" />
              </InfoBannerIcon>
              <InfoBannerContent>
                <InfoBannerTitle>Automatic Account Creation</InfoBannerTitle>
                <InfoBannerDescription>
                  Accounts are automatically created when you sign in with one
                  of the available authentication methods. Please proceed to the{" "}
                  <Link
                    to="/auth/login"
                    className="underline text-primary hover:text-primary/90 font-medium"
                  >
                    login page
                  </Link>
                  .
                </InfoBannerDescription>
              </InfoBannerContent>
            </InfoBanner>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-[80vh] flex items-center justify-center">
      <Card className="w-full max-w-md">
        <CardHeader className="flex flex-col space-y-1 items-center">
          <CardTitle>Create your account</CardTitle>
          <CardDescription>
            {hasCredential && hasSocial
              ? "Choose your preferred registration method"
              : hasCredential
              ? "Enter your details to get started"
              : "Continue to create your account"}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            {/* Credential Registration Form */}
            {hasCredential && (
              <form className="space-y-4" onSubmit={handleCredentialRegister}>
                <div className="space-y-2">
                  <Label htmlFor="name">Name</Label>
                  <Input
                    id="name"
                    placeholder="John Doe"
                    type="text"
                    required
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="email">Email</Label>
                  <Input
                    id="email"
                    placeholder="name@example.com"
                    type="email"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="password">Password</Label>
                  <Input
                    id="password"
                    required
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                  />
                </div>
                <Button type="submit" className="w-full" disabled={loading}>
                  {loading ? "Creating Account..." : "Create Account"}
                </Button>
              </form>
            )}

            {/* Separator */}
            {hasCredential && hasSocial && (
              <div className="relative">
                <div className="absolute inset-0 flex items-center">
                  <span className="w-full border-t border-border" />
                </div>
                <div className="relative flex justify-center text-xs uppercase">
                  <span className="bg-card px-2 text-muted-foreground">
                    Or continue with
                  </span>
                </div>
              </div>
            )}

            {/* Social Provider Buttons */}
            {hasSocial && (
              <div className="space-y-2">
                {socialStrategies.map((strategy) => (
                  <SocialProviderButton
                    key={strategy.id}
                    displayName={strategy.displayName}
                    icon={strategy.icon}
                    onClick={() => handleSocialRegister(strategy.id)}
                  />
                ))}
              </div>
            )}
          </div>
        </CardContent>
        <CardFooter className="flex justify-center border-t border-border mt-4 pt-4">
          <div className="text-sm">
            Already have an account?{" "}
            <Link
              to={resolveRoute(authRoutes.routes.login)}
              className="underline text-primary hover:text-primary/90 font-medium"
            >
              Sign in
            </Link>
          </div>
        </CardFooter>
      </Card>
    </div>
  );
};
