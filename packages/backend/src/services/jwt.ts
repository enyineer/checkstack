import { SignJWT, jwtVerify } from "jose";

const jwtSecret = process.env.JWT_SECRET;
if (!jwtSecret) {
  throw new Error("JWT_SECRET is not set");
}

const SECRET = new TextEncoder().encode(jwtSecret);

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
