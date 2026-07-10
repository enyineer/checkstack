import React, { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { LogIn, LogOut, AlertCircle, ArrowLeft, Lock } from "lucide-react";
import {
  useApi,
  ExtensionSlot,
  usePluginClient,
  UserMenuItemsSlot,
  UserMenuItemsContext,
} from "@checkstack/frontend-api";
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
  UserMenu,
  DropdownMenuItem,
  Alert,
  AlertIcon,
  AlertContent,
  AlertTitle,
  AlertDescription,
  usePerformance,
  cn,
} from "@checkstack/ui";
import { useToast, toastError } from "@checkstack/ui";
import { authApiRef, EnabledAuthStrategy } from "../api";
import { useEnabledStrategies } from "../hooks/useEnabledStrategies";
import { useAccessRules } from "../hooks/useAccessRules";
import { getAuthClientLazy } from "../lib/auth-client";
import { SocialProviderButton } from "./SocialProviderButton";
import { AuthLandingCard } from "./AuthLandingCard";
import { useEffect } from "react";

export const LoginPage = () => {
  const [activeStrategy, setActiveStrategy] = useState<
    EnabledAuthStrategy | undefined
  >();
  const [formValues, setFormValues] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  const navigate = useNavigate();
  const authApi = useApi(authApiRef);
  const authClient = usePluginClient(AuthApi);
  const { strategies, loading: strategiesLoading } = useEnabledStrategies();
  const toast = useToast();
  const { isLowPower } = usePerformance();

  // Query: Registration status
  const { data: registrationData } = authClient.getRegistrationStatus.useQuery(
    {},
  );
  const registrationAllowed = registrationData?.allowRegistration ?? true;

  const handleCredentialLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(undefined);
    try {
      const { error } = await authApi.signIn(email, password);
      if (error) {
        setError(error.message);
      } else {
        globalThis.location.href = "/";
      }
    } finally {
      setLoading(false);
    }
  };

  const handleProviderClick = async (strategy: EnabledAuthStrategy) => {
    setError(undefined);
    const flow = strategy.clientFlow;

    // Use default OAuth flow if no clientFlow provided (backward compat)
    if (!flow || flow.type === "oauth") {
      try {
        await authApi.signInWithSocial(strategy.id);
      } catch (error) {
        setError("Failed to initialize social login");
        toastError(toast, "Failed to initialize social login", error);
      }
      return;
    }

    if (flow.type === "redirect") {
      navigate(flow.target);
      return;
    }

    if (flow.type === "form") {
      setActiveStrategy(strategy);
      setFormValues({});
      return;
    }
  };

  const handleCustomFormSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const flow = activeStrategy?.clientFlow;
    if (flow?.type !== "form") return;

    setLoading(true);
    setError(undefined);
    try {
      const response = await fetch(flow.target, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(formValues),
      });

      if (response.redirected) {
        globalThis.location.href = response.url;
        return;
      }

      if (response.ok) {
        const data = await response.json().catch(() => ({ success: true }));
        if (data.success) {
          globalThis.location.href = "/";
          return;
        }
        setError(data.error?.message || "Authentication failed");
      } else {
        const data = await response.json().catch(() => ({}));
        setError(data.error?.message || "Authentication failed");
      }
    } catch (error) {
      toastError(toast, "Social login failed", error);
    }
  };

  const credentialStrategy = strategies.find(
    (s) => s.id === "credential" || s.clientFlow?.type === "credential",
  );
  const providerStrategies = strategies.filter(
    (s) =>
      s.id !== "credential" &&
      (!s.clientFlow || s.clientFlow.type !== "credential"),
  );
  const hasCredential = !!credentialStrategy;
  const hasProviders = providerStrategies.length > 0;

  // Loading state
  if (strategiesLoading) {
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

  // No strategies enabled
  if (strategies.length === 0) {
    return (
      <div className="min-h-[80vh] flex items-center justify-center">
        <AuthLandingCard>
          <CardHeader className="flex flex-col space-y-1 items-center">
            <div className="grid size-12 place-items-center rounded-full bg-surface-inset">
              <Lock className="h-5 w-5 text-muted-foreground" />
            </div>
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
        </AuthLandingCard>
      </div>
    );
  }

  return (
    <div className="min-h-[80vh] flex items-center justify-center">
      <AuthLandingCard>
        <CardHeader className="flex flex-col space-y-1 items-center">
          <div className="grid size-12 place-items-center rounded-full bg-surface-inset">
            <Lock className="h-5 w-5 text-muted-foreground" />
          </div>
          <CardTitle>Sign in to your account</CardTitle>
          <CardDescription>
            {hasCredential && hasProviders
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
              <Alert variant="warning">
                <AlertIcon>
                  <AlertCircle className="h-4 w-4" />
                </AlertIcon>
                <AlertContent>
                  <AlertTitle>Registration Disabled</AlertTitle>
                  <AlertDescription>
                    New user registration is currently disabled. Please contact
                    an administrator if you need access.
                  </AlertDescription>
                </AlertContent>
              </Alert>
            )}

            {/* Generic Error Alert */}
            {error && (
              <Alert variant="warning">
                <AlertIcon>
                  <AlertCircle className="h-4 w-4" />
                </AlertIcon>
                <AlertContent>
                  <AlertDescription>{error}</AlertDescription>
                </AlertContent>
              </Alert>
            )}

            {/* Main Login Options */}
            {!activeStrategy && (
              <>
                {/* Internal Credential Form */}
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
                      <div className="text-right">
                        <Link
                          to={resolveRoute(authRoutes.routes.forgotPassword)}
                          className="text-sm text-primary hover:underline"
                        >
                          Forgot password?
                        </Link>
                      </div>
                    </div>
                    <Button type="submit" className="w-full" disabled={loading}>
                      {loading ? "Signing In..." : "Sign In"}
                    </Button>
                  </form>
                )}

                {/* Separator */}
                {hasCredential && hasProviders && (
                  <div className="relative">
                    <div className="absolute inset-0 flex items-center">
                      <span className="w-full border-t border-border/60" />
                    </div>
                    <div className="relative flex justify-center text-xs uppercase">
                      <span className="bg-surface-2 px-2 text-muted-foreground">
                        Or continue with
                      </span>
                    </div>
                  </div>
                )}

                {/* Provider Buttons (OAuth, Redirect, or trigger Form view) */}
                {hasProviders && (
                  <div className="space-y-2">
                    {providerStrategies.map((strategy) => (
                      <SocialProviderButton
                        key={strategy.id}
                        displayName={strategy.displayName}
                        icon={strategy.icon}
                        onClick={() => handleProviderClick(strategy)}
                      />
                    ))}
                  </div>
                )}
              </>
            )}

            {/* Custom Form View (e.g. LDAP) */}
            {activeStrategy && activeStrategy.clientFlow?.type === "form" && (
              <form className="space-y-4" onSubmit={handleCustomFormSubmit}>
                {(() => {
                  const flow = activeStrategy.clientFlow;
                  if (flow?.type !== "form") return;

                  return (
                    <>
                      <div className="flex items-center mb-2">
                        <Button
                          variant="ghost"
                          size="sm"
                          className="p-0 h-auto hover:bg-transparent -ml-1 text-muted-foreground hover:text-foreground"
                          onClick={() => {
                            setActiveStrategy(undefined);
                            setError(undefined);
                          }}
                        >
                          <ArrowLeft className="h-4 w-4 mr-1" />
                          Back
                        </Button>
                      </div>

                      <div className="space-y-2">
                        <h4 className="font-medium text-sm">
                          Log in with {activeStrategy.displayName}
                        </h4>
                        {activeStrategy.description && (
                          <p className="text-xs text-muted-foreground">
                            {activeStrategy.description}
                          </p>
                        )}
                      </div>

                      {flow.fields.map((field) => (
                        <div key={field.name} className="space-y-2">
                          <Label htmlFor={field.name}>{field.label}</Label>
                          <Input
                            id={field.name}
                            name={field.name}
                            type={field.type}
                            placeholder={field.placeholder}
                            required
                            value={formValues[field.name] || ""}
                            onChange={(e) =>
                              setFormValues((prev) => ({
                                ...prev,
                                [field.name]: e.target.value,
                              }))
                            }
                          />
                        </div>
                      ))}

                      <Button
                        type="submit"
                        className="w-full"
                        disabled={loading}
                      >
                        {loading ? "Processing..." : "Continue"}
                      </Button>
                    </>
                  );
                })()}
              </form>
            )}
          </div>
        </CardContent>
        {registrationAllowed &&
          strategies.some((s) => s.requiresManualRegistration) && (
            <CardFooter className="flex justify-center border-t border-border/60 mt-4 pt-4">
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
      </AuthLandingCard>
    </div>
  );
};

export const LogoutMenuItem = (_props: UserMenuItemsContext) => {
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
  const { accessRules, loading: accessRulesLoading } = useAccessRules();
  const [hasCredentialAccount, setHasCredentialAccount] =
    useState<boolean>(false);
  const [credentialLoading, setCredentialLoading] = useState(true);
  const { isLowPower } = usePerformance();

  useEffect(() => {
    if (!session?.user) {
      setCredentialLoading(false);
      return;
    }
    getAuthClientLazy().listAccounts().then((result) => {
      if (result.data) {
        const hasCredential = result.data.some(
          (account) => account.providerId === "credential",
        );
        setHasCredentialAccount(hasCredential);
      }
      setCredentialLoading(false);
    });
  }, [session?.user]);

  if (isPending || accessRulesLoading || credentialLoading) {
    return (
      <div
        className={cn(
          "w-20 h-9 bg-muted rounded-full",
          !isLowPower && "animate-pulse",
        )}
      />
    );
  }

  if (session?.user) {
    // The user menu is account-only: profile header (rendered by UserMenu) plus
    // the item slot (help, theme, low-power, density, about, logout), ordered by
    // each extension's `priority`. Feature navigation lives in the left sidebar
    // (routes that declare `nav` metadata).
    const menuContext: UserMenuItemsContext = {
      accessRules,
      hasCredentialAccount,
    };

    return (
      <UserMenu
        user={session.user}
        profileHref={resolveRoute(authRoutes.routes.profile)}
      >
        <ExtensionSlot slot={UserMenuItemsSlot} context={menuContext} />
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
