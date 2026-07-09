/**
 * Built-in platform role ids. Kept in this leaf module (no imports) so both the
 * auth router and the {@link RoleMembershipStore} can reference them without a
 * circular import.
 */
export const ADMIN_ROLE_ID = "admin";
export const USERS_ROLE_ID = "users";
export const ANONYMOUS_ROLE_ID = "anonymous";
export const APPLICATIONS_ROLE_ID = "applications";
