import { SignJWT, jwtVerify, importJWK, JWK } from "jose";
import { keyStore } from "./keystore";
import { rootLogger } from "../logger";

const logger = rootLogger.child({ service: "JwtService" });

export const jwtService = {
  /**
   * Signs a JWT payload for service-to-service communication
   */
  sign: async (payload: Record<string, unknown>, expiresIn = "1h") => {
    const { kid, key } = await keyStore.getSigningKey();

    return await new SignJWT(payload)
      .setProtectedHeader({ alg: "RS256", kid })
      .setIssuedAt()
      .setExpirationTime(expiresIn)
      .sign(key);
  },

  /**
   * Verifies a JWT token using the KeyStore
   */
  verify: async (token: string) => {
    try {
      const { keys } = await keyStore.getPublicJWKS();

      // Custom GetKey function for jose
      const getKey = async (protectedHeader: { kid?: string }) => {
        const kid = protectedHeader.kid;
        if (!kid) throw new Error("Missing kid in header");

        const jwk = keys.find((k: { kid?: string }) => k.kid === kid);
        if (!jwk) {
          throw new Error(`Key with kid ${kid} not found`);
        }
        return importJWK(jwk as JWK, "RS256");
      };

      const { payload } = await jwtVerify(token, getKey, {
        algorithms: ["RS256"],
      });
      return payload;
    } catch (error) {
      logger.error("JWT Verification failed:", error);
      return;
    }
  },
};
