import { z } from "zod";

/**
 * Platform-level configuration for user registration.
 * This meta-config controls whether new users can register via any authentication method.
 */
export const platformRegistrationConfigV1 = z.object({
  /**
   * Whether new user registration is allowed.
   * When false, only existing users can authenticate.
   */
  allowRegistration: z.boolean().default(true),
});

export type PlatformRegistrationConfig = z.infer<
  typeof platformRegistrationConfigV1
>;

export const PLATFORM_REGISTRATION_CONFIG_VERSION = 1;
export const PLATFORM_REGISTRATION_CONFIG_ID = "platform.registration";
