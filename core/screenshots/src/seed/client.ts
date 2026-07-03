import {
  createCheckstackClient,
  type CheckstackClient,
} from "@checkstack/sdk";
import { ADMIN, AUTH_BASE, REST_URL } from "../config.ts";

/**
 * Authenticate the seed script and hand back a fully-typed, admin-authenticated
 * `@checkstack/sdk` client.
 *
 * Bootstrap chain against a fresh database:
 *  1. `auth.completeOnboarding` (anonymous, one-shot) creates the first admin.
 *  2. better-auth `sign-in/email` returns the session cookie for that admin.
 *  3. We build an SDK client that forwards that cookie on every REST call, so
 *     the admin (who holds every access rule) authorizes all seed writes.
 *
 * The same admin credentials drive the capture browser's UI login, so the
 * navbar avatar and profile screens show a real, named user.
 */
export async function onboardAndAuthenticate(): Promise<CheckstackClient> {
  const anon = createCheckstackClient({ baseUrl: REST_URL });
  await anon.auth.completeOnboarding({
    name: ADMIN.name,
    email: ADMIN.email,
    password: ADMIN.password,
  });

  const cookie = await signInForCookie();
  return createCheckstackClient({ baseUrl: REST_URL, headers: { cookie } });
}

/**
 * Sign in through better-auth and return a `Cookie` header value carrying the
 * session token. We forward every Set-Cookie pair (name=value) so the session
 * cookie is included regardless of its exact prefixed name.
 */
async function signInForCookie(): Promise<string> {
  const res = await fetch(`${AUTH_BASE}/sign-in/email`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: ADMIN.email, password: ADMIN.password }),
  });
  if (!res.ok) {
    throw new Error(
      `Admin sign-in failed: ${res.status} ${await res.text().catch(() => "")}`,
    );
  }
  const setCookies = res.headers.getSetCookie();
  if (setCookies.length === 0) {
    throw new Error("Admin sign-in returned no Set-Cookie header");
  }
  // Reduce each "name=value; Path=/; ..." to "name=value" and join with "; ".
  return setCookies.map((c) => c.split(";", 1)[0]).join("; ");
}
