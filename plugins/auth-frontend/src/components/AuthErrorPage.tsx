import { Link, useSearchParams } from "react-router-dom";
import { AlertCircle, Home, LogIn } from "lucide-react";
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
} from "@checkmate/ui";

/**
 * Map technical error messages to user-friendly ones
 */
const getErrorMessage = (error: string | undefined): string => {
  if (!error) {
    return "An unexpected error occurred during authentication.";
  }

  // Registration disabled error
  if (error.includes("Registration is currently disabled")) {
    return "Registration is currently disabled. Please contact an administrator if you need access.";
  }

  // User denied authorization
  if (error.includes("access_denied") || error.includes("user_denied")) {
    return "Authorization was cancelled. Please try again if you wish to sign in.";
  }

  // Generic OAuth errors
  if (error.includes("UNKNOWN") || error.includes("unknown")) {
    return "An unexpected error occurred. Please try again or contact support if the problem persists.";
  }

  // Return the error as-is if it seems user-friendly
  return error;
};

export const AuthErrorPage = () => {
  const [searchParams] = useSearchParams();
  const errorParam = searchParams.get("error");

  // better-auth encodes error messages using underscores for spaces
  // Decode by replacing underscores with spaces
  const decodedError = errorParam?.replaceAll("_", " ") ?? undefined;

  const errorMessage = getErrorMessage(decodedError);

  return (
    <div className="min-h-[80vh] flex items-center justify-center">
      <Card className="w-full max-w-md">
        <CardHeader className="flex flex-col space-y-1 items-center">
          <CardTitle>Authentication Error</CardTitle>
          <CardDescription>
            We encountered a problem during sign-in
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Alert variant="error">
            <AlertIcon>
              <AlertCircle className="h-4 w-4" />
            </AlertIcon>
            <AlertContent>
              <AlertTitle>Sign-in Failed</AlertTitle>
              <AlertDescription>{errorMessage}</AlertDescription>
            </AlertContent>
          </Alert>
        </CardContent>
        <CardFooter className="flex gap-2 justify-center">
          <Link to="/auth/login">
            <Button variant="primary">
              <LogIn className="mr-2 h-4 w-4" />
              Try Again
            </Button>
          </Link>
          <Link to="/">
            <Button variant="outline">
              <Home className="mr-2 h-4 w-4" />
              Go Home
            </Button>
          </Link>
        </CardFooter>
      </Card>
    </div>
  );
};
