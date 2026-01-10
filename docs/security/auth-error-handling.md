---
---
# Custom Authentication Strategy Error Handling

When implementing custom authentication strategies (like LDAP or custom OAuth providers), it's important to provide a consistent error experience for end users. The `auth-backend` plugin provides utilities to redirect authentication errors to a centralized error page with user-friendly messages.

## The Error Redirect Utility

The `redirectToAuthError` utility ensures all authentication errors are handled consistently by redirecting users to `/auth/error` with properly encoded error messages.

### Usage

```typescript
import { redirectToAuthError } from "@checkstack/auth-backend";

// In your custom HTTP authentication handler
rpc.registerHttpHandler("/api/auth-backend/custom/login", async (req: Request) => {
  try {
    const credentials = await req.json();
    
    // Validate credentials
    if (!credentials.username || !credentials.password) {
      return redirectToAuthError("Username and password are required");
    }
    
    // Authenticate user
    const result = await authenticateUser(credentials);
    
    if (!result.success) {
      return redirectToAuthError(
        result.error || "Authentication failed"
      );
    }
    
    // Success - return session cookie
    return Response.json({ success: true }, {
      headers: {
        "Set-Cookie": `session=${result.sessionToken}; ...`
      }
    });
    
  } catch (error) {
    logger.error("Auth error:", error);
    const message = error instanceof Error 
      ? error.message 
      : "Authentication failed. Please try again.";
    return redirectToAuthError(message);
  }
});
```

## Available Functions

### `redirectToAuthError(errorMessage, frontendUrl?)`

Creates an HTTP redirect response to the auth error page.

**Parameters:**
- `errorMessage` (string): User-friendly error message  
- `frontendUrl` (string, optional): Frontend base URL (defaults to `BASE_URL` env var)

**Returns:** `Response` - HTTP 302 redirect to `/auth/error`

**Example:**
```typescript
return redirectToAuthError("Invalid credentials");
// Redirects to: http://localhost:5173/auth/error?error=Invalid_credentials
```

### `buildAuthErrorUrl(errorMessage, frontendUrl?)`

Builds the error page URL without creating a redirect response.

**Parameters:**
- `errorMessage` (string): User-friendly error message
- `frontendUrl` (string, optional): Frontend base URL

**Returns:** `string` - Full URL to error page

**Example:**
```typescript
const errorUrl = buildAuthErrorUrl("Session expired");
// Returns: "http://localhost:5173/auth/error?error=Session_expired"
```

### `encodeAuthError(message)`

Encodes error messages for URL transmission (replaces spaces with underscores, following better-auth convention).

**Parameters:**
- `message` (string): Error message to encode

**Returns:** `string` - Encoded message

**Example:**
```typescript
const encoded = encodeAuthError("User not found");
// Returns: "User_not_found"
```

## Best Practices

### 1. Use User-Friendly Messages

Always provide clear, actionable error messages:

```typescript
// ✅ Good - clear and actionable
redirectToAuthError("Invalid credentials. Please try again.");

// ❌ Bad - technical jargon
redirectToAuthError("LDAP bind failed: ERR_INVALID_DN");
```

### 2. Handle All Error Cases

Ensure every error path redirects to the error page:

```typescript
try {
  // ... auth logic ...
} catch (error) {
  // Always redirect, never return JSON errors
  return redirectToAuthError(
    error instanceof Error ? error.message : "Authentication failed"
  );
}
```

### 3. Check Registration Status

For strategies that auto-create users, check if registration is allowed:

```typescript
import { AuthApi } from "@checkstack/auth-common";

// Check platform registration status
const authClient = rpcClient.forPlugin(AuthApi);
const { allowRegistration } = await authClient.getRegistrationStatus();

if (!allowRegistration) {
  return redirectToAuthError(
    "Registration is disabled. Please contact an administrator."
  );
}
```

## Error Page Behavior

The `/auth/error` page:
- Decodes underscore-encoded messages (converts `_` back to spaces)
- Maps technical errors to user-friendly equivalents
- Provides "Try Again" and "Go Home" buttons for navigation
- Uses consistent styling with the rest of the application

## Testing

When testing your custom auth strategy:

1. **Test with invalid credentials:**
   ```bash
   curl -X POST http://localhost:3000/api/auth-backend/custom/login \
     -H "Content-Type: application/json" \
     -d '{"username":"wrong","password":"wrong"}'
   ```
   Should redirect to `/auth/error`

2. **Test with missing fields:**
   ```bash
   curl -X POST http://localhost:3000/api/auth-backend/custom/login \
     -H "Content-Type: application/json" \
     -d '{}'
   ```
   Should redirect to `/auth/error` with validation message

3. **Verify error messages are user-friendly:**
   - Navigate to the error page in a browser
   - Confirm underscores are converted to spaces
   - Check that messages are clear and actionable

## Example: LDAP Plugin

See `plugins/auth-ldap-backend/src/index.ts` for a complete reference implementation that uses `redirectToAuthError` for all error cases in a custom authentication handler.
