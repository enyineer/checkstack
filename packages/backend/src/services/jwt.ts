import { SignJWT, jwtVerify } from "jose";

const SECRET = new TextEncoder().encode(
  process.env.JWT_SECRET || "default-secret-do-not-use-in-prod"
);

export const jwtService = {
  /**
   * Signs a JWT payload for service-to-service communication
   */
  sign: async (payload: Record<string, unknown>, expiresIn = "1h") => {
    return await new SignJWT(payload)
      .setProtectedHeader({ alg: "HS256" })
      .setIssuedAt()
      .setExpirationTime(expiresIn)
      .sign(SECRET);
  },

  /**
   * Verifies a JWT token
   */
  verify: async (token: string) => {
    try {
      const { payload } = await jwtVerify(token, SECRET);
      return payload;
    } catch (error) {
      console.error("JWT Verification failed:", error);
      return;
    }
  },
};
