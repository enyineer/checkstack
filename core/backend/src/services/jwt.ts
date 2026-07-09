import { SignJWT, jwtVerify, importJWK, decodeProtectedHeader } from "jose";
import { keyStore } from "./keystore";

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
      const headerKid = decodeProtectedHeader(token).kid;
      let { keys } = await keyStore.getPublicJWKS();
      // The token's signing key may have been minted on another pod after this
      // pod last cached the JWKS. If its kid is absent from the cached set,
      // force ONE refresh before giving up, so a freshly-rotated key is never
      // spuriously rejected (the cache is otherwise TTL-bounded per pod).
      if (headerKid && !keys.some((k) => k.kid === headerKid)) {
        const refreshed = await keyStore.getPublicJWKS({ forceRefresh: true });
        keys = refreshed.keys;
      }

      // Custom GetKey function for jose
      const getKey = async (protectedHeader: { kid?: string }) => {
        const kid = protectedHeader.kid;
        if (!kid) throw new Error("Missing kid in header");

        const jwk = keys.find((k) => k.kid === kid);
        if (!jwk) {
          throw new Error(`Key with kid ${kid} not found`);
        }
        return importJWK(jwk, "RS256");
      };

      const { payload } = await jwtVerify(token, getKey, {
        algorithms: ["RS256"],
      });
      return payload;
    } catch {
      return;
    }
  },
};
