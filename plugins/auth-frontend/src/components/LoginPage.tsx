import React, { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { LogIn, LogOut } from "lucide-react";
import { useApi, ExtensionSlot, pluginRegistry } from "@checkmate/frontend-api";
import { authApiRef } from "../api";
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
} from "@checkmate/ui";

export const LoginPage = () => {
  // ... existing implementation remains the same
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();
  const authApi = useApi(authApiRef);

  const handleLogin = async (e: React.FormEvent) => {
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

  return (
    <div className="min-h-[80vh] flex items-center justify-center">
      <Card className="w-full max-w-md">
        <CardHeader className="flex flex-col space-y-1 items-center">
          <CardTitle>Sign in to your account</CardTitle>
          <CardDescription>
            Enter your credentials to access the dashboard
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form className="space-y-4" onSubmit={handleLogin}>
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
        </CardContent>
        <CardFooter className="flex justify-center border-t border-gray-100 mt-4 pt-4">
          <div className="text-sm">
            Don't have an account?{" "}
            <Link
              to="/auth/register"
              className="underline text-indigo-600 hover:text-indigo-800 font-medium"
            >
              Sign up
            </Link>
          </div>
        </CardFooter>
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
    return <div className="w-20 h-9 bg-gray-100 animate-pulse rounded-full" />;
  }

  if (session?.user) {
    // Check if we have any bottom items to decide if we need a separator
    const bottomExtensions = pluginRegistry.getExtensions(
      "core.layout.navbar.user-menu.items.bottom"
    );
    const hasBottomItems = bottomExtensions.length > 0;

    return (
      <UserMenu user={session.user}>
        <ExtensionSlot id="core.layout.navbar.user-menu.items" />
        {hasBottomItems && <DropdownMenuSeparator />}
        <ExtensionSlot id="core.layout.navbar.user-menu.items.bottom" />
      </UserMenu>
    );
  }

  return (
    <Link to="/auth/login">
      <Button variant="outline" className="flex items-center rounded-full px-5">
        <LogIn className="mr-2 h-4 w-4" />
        Login
      </Button>
    </Link>
  );
};
