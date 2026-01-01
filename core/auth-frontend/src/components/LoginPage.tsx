import React, { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { LogIn, LogOut, AlertCircle } from "lucide-react";
import {
  useApi,
  ExtensionSlot,
  pluginRegistry,
  rpcApiRef,
  UserMenuItemsSlot,
  UserMenuItemsBottomSlot,
} from "@checkmate/frontend-api";
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
  UserMenu,
  DropdownMenuItem,
  DropdownMenuSeparator,
  Alert,
  AlertIcon,
  AlertContent,
  AlertTitle,
  AlertDescription,
  InfoBanner,
  InfoBannerIcon,
  InfoBannerContent,
  InfoBannerTitle,
  InfoBannerDescription,
} from "@checkmate/ui";
import { authApiRef } from "../api";
import { useEnabledStrategies } from "../hooks/useEnabledStrategies";
import { SocialProviderButton } from "./SocialProviderButton";
import { useEffect } from "react";

export const LoginPage = () => {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();
  const authApi = useApi(authApiRef);
  const rpcApi = useApi(rpcApiRef);
  const authRpcClient = rpcApi.forPlugin<AuthClient>("auth-backend");
  const { strategies, loading: strategiesLoading } = useEnabledStrategies();
  const [registrationAllowed, setRegistrationAllowed] = useState<boolean>(true);

  useEffect(() => {
    authRpcClient
      .getRegistrationStatus()
      .then(({ allowRegistration }) => {
        setRegistrationAllowed(allowRegistration);
      })
      .catch((error: Error) => {
        console.error("Failed to check registration status:", error);
        setRegistrationAllowed(true);
      });
  }, [authRpcClient]);

  const handleCredentialLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      const { error } = await authApi.signIn(email, password);
      if (error) {
        console.error("Login failed:", error);
      } else {
        navigate("/");
      }
    } finally {
      setLoading(false);
    }
  };

  const handleSocialLogin = async (provider: string) => {
    try {
      await authApi.signInWithSocial(provider);
      // Navigation will happen automatically after OAuth redirect
    } catch (error) {
      console.error("Social login failed:", error);
    }
  };

  const credentialStrategy = strategies.find((s) => s.type === "credential");
  const socialStrategies = strategies.filter((s) => s.type === "social");
  const hasCredential = !!credentialStrategy;
  const hasSocial = socialStrategies.length > 0;

  // Loading state
  if (strategiesLoading) {
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

  // No strategies enabled
  if (strategies.length === 0) {
    return (
      <div className="min-h-[80vh] flex items-center justify-center">
        <Card className="w-full max-w-md">
          <CardHeader className="flex flex-col space-y-1 items-center">
            <CardTitle>Authentication Unavailable</CardTitle>
          </CardHeader>
          <CardContent>
            <Alert variant="warning">
              <AlertIcon>
                <AlertCircle className="h-4 w-4" />
              </AlertIcon>
              <AlertContent>
                <AlertTitle>No authentication methods enabled</AlertTitle>
                <AlertDescription>
                  Please contact your system administrator to enable
                  authentication methods.
                </AlertDescription>
              </AlertContent>
            </Alert>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-[80vh] flex items-center justify-center">
      <Card className="w-full max-w-md">
        <CardHeader className="flex flex-col space-y-1 items-center">
          <CardTitle>Sign in to your account</CardTitle>
          <CardDescription>
            {hasCredential && hasSocial
              ? "Choose your preferred sign-in method"
              : hasCredential
              ? "Enter your credentials to access the dashboard"
              : "Continue with your account"}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            {/* Registration Disabled Banner */}
            {!registrationAllowed && (
              <InfoBanner variant="warning">
                <InfoBannerIcon>
                  <AlertCircle className="h-4 w-4" />
                </InfoBannerIcon>
                <InfoBannerContent>
                  <InfoBannerTitle>Registration Disabled</InfoBannerTitle>
                  <InfoBannerDescription>
                    New user registration is currently disabled. Please contact
                    an administrator if you need access.
                  </InfoBannerDescription>
                </InfoBannerContent>
              </InfoBanner>
            )}

            {/* Credential Form */}
            {hasCredential && (
              <form className="space-y-4" onSubmit={handleCredentialLogin}>
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
                  {loading ? "Signing In..." : "Sign In"}
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
                    onClick={() => handleSocialLogin(strategy.id)}
                  />
                ))}
              </div>
            )}
          </div>
        </CardContent>
        {registrationAllowed &&
          strategies.some((s) => s.requiresManualRegistration) && (
            <CardFooter className="flex justify-center border-t border-border mt-4 pt-4">
              <div className="text-sm">
                Don't have an account?{" "}
                <Link
                  to={resolveRoute(authRoutes.routes.register)}
                  className="underline text-primary hover:text-primary/90 font-medium"
                >
                  Sign up
                </Link>
              </div>
            </CardFooter>
          )}
      </Card>
    </div>
  );
};

export const LogoutMenuItem = () => {
  const authApi = useApi(authApiRef);

  return (
    <DropdownMenuItem
      onClick={() => authApi.signOut()}
      icon={<LogOut className="h-4 w-4" />}
    >
      Logout
    </DropdownMenuItem>
  );
};

export const LoginNavbarAction = () => {
  const authApi = useApi(authApiRef);
  const { data: session, isPending } = authApi.useSession();

  if (isPending) {
    return <div className="w-20 h-9 bg-muted animate-pulse rounded-full" />;
  }

  if (session?.user) {
    // Check if we have any bottom items to decide if we need a separator
    const bottomExtensions = pluginRegistry.getExtensions(
      UserMenuItemsBottomSlot.id
    );
    const hasBottomItems = bottomExtensions.length > 0;

    return (
      <UserMenu user={session.user}>
        <ExtensionSlot slot={UserMenuItemsSlot} />
        {hasBottomItems && <DropdownMenuSeparator />}
        <ExtensionSlot slot={UserMenuItemsBottomSlot} />
      </UserMenu>
    );
  }

  return (
    <Link to={resolveRoute(authRoutes.routes.login)}>
      <Button variant="outline" className="flex items-center rounded-full px-5">
        <LogIn className="mr-2 h-4 w-4" />
        Login
      </Button>
    </Link>
  );
};
