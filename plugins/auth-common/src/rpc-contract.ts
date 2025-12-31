import { oc } from "@orpc/contract";
import type { ContractRouterClient } from "@orpc/contract";
import type { ProcedureMetadata } from "@checkmate/common";
import { z } from "zod";
import { permissions } from "./index";

// Base builder with full metadata support
const _base = oc.$meta<ProcedureMetadata>({});

// Zod schemas for return types
const UserDtoSchema = z.object({
  id: z.string(),
  email: z.string(),
  name: z.string(),
  roles: z.array(z.string()),
});

const RoleDtoSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().optional().nullable(),
  permissions: z.array(z.string()),
  isSystem: z.boolean().optional(),
  isAssignable: z.boolean().optional(), // False for anonymous role
});

const PermissionDtoSchema = z.object({
  id: z.string(),
  description: z.string().optional(),
});

const StrategyDtoSchema = z.object({
  id: z.string(),
  displayName: z.string(),
  description: z.string().optional(),
  enabled: z.boolean(),
  configVersion: z.number(),
  configSchema: z.record(z.string(), z.unknown()), // JSON Schema representation
  config: z.record(z.string(), z.unknown()).optional(), // VersionedConfig.data (secrets redacted)
});

const EnabledStrategyDtoSchema = z.object({
  id: z.string(),
  displayName: z.string(),
  description: z.string().optional(),
  type: z.enum(["credential", "social"]),
  icon: z.string().optional(), // Lucide icon name
  requiresManualRegistration: z.boolean(),
});

const RegistrationStatusSchema = z.object({
  allowRegistration: z.boolean(),
});

// Auth RPC Contract with full metadata
export const authContract = {
  // ==========================================================================
  // ANONYMOUS ENDPOINTS (userType: "anonymous")
  // These can be called without authentication (login/registration pages)
  // ==========================================================================

  getEnabledStrategies: _base
    .meta({ userType: "anonymous" })
    .output(z.array(EnabledStrategyDtoSchema)),

  getRegistrationStatus: _base
    .meta({ userType: "anonymous" })
    .output(RegistrationStatusSchema),

  // ==========================================================================
  // AUTHENTICATED ENDPOINTS (userType: "authenticated" - no specific permission)
  // ==========================================================================

  permissions: _base
    .meta({ userType: "authenticated" }) // Any authenticated user can check their own permissions
    .output(z.object({ permissions: z.array(z.string()) })),

  // ==========================================================================
  // USER MANAGEMENT (userType: "user" with permissions)
  // ==========================================================================

  getUsers: _base
    .meta({ userType: "user", permissions: [permissions.usersRead.id] })
    .output(z.array(UserDtoSchema)),

  deleteUser: _base
    .meta({ userType: "user", permissions: [permissions.usersManage.id] })
    .input(z.string())
    .output(z.void()),

  updateUserRoles: _base
    .meta({ userType: "user", permissions: [permissions.usersManage.id] })
    .input(
      z.object({
        userId: z.string(),
        roles: z.array(z.string()),
      })
    )
    .output(z.void()),

  // ==========================================================================
  // ROLE MANAGEMENT (userType: "user" with permissions)
  // ==========================================================================

  getRoles: _base
    .meta({ userType: "user", permissions: [permissions.rolesRead.id] })
    .output(z.array(RoleDtoSchema)),

  getPermissions: _base
    .meta({ userType: "user", permissions: [permissions.rolesRead.id] })
    .output(z.array(PermissionDtoSchema)),

  createRole: _base
    .meta({ userType: "user", permissions: [permissions.rolesCreate.id] })
    .input(
      z.object({
        name: z.string(),
        description: z.string().optional(),
        permissions: z.array(z.string()),
      })
    )
    .output(z.void()),

  updateRole: _base
    .meta({ userType: "user", permissions: [permissions.rolesUpdate.id] })
    .input(
      z.object({
        id: z.string(),
        name: z.string().optional(),
        description: z.string().optional(),
        permissions: z.array(z.string()),
      })
    )
    .output(z.void()),

  deleteRole: _base
    .meta({ userType: "user", permissions: [permissions.rolesDelete.id] })
    .input(z.string())
    .output(z.void()),

  // ==========================================================================
  // STRATEGY MANAGEMENT (userType: "user" with permissions)
  // ==========================================================================

  getStrategies: _base
    .meta({ userType: "user", permissions: [permissions.strategiesManage.id] })
    .output(z.array(StrategyDtoSchema)),

  updateStrategy: _base
    .meta({ userType: "user", permissions: [permissions.strategiesManage.id] })
    .input(
      z.object({
        id: z.string(),
        enabled: z.boolean(),
        config: z.record(z.string(), z.unknown()).optional(),
      })
    )
    .output(z.object({ success: z.boolean() })),

  reloadAuth: _base
    .meta({ userType: "user", permissions: [permissions.strategiesManage.id] })
    .output(z.object({ success: z.boolean() })),

  // ==========================================================================
  // REGISTRATION MANAGEMENT (userType: "user" with permissions)
  // ==========================================================================

  getRegistrationSchema: _base
    .meta({
      userType: "user",
      permissions: [permissions.registrationManage.id],
    })
    .output(z.record(z.string(), z.unknown())),

  setRegistrationStatus: _base
    .meta({
      userType: "user",
      permissions: [permissions.registrationManage.id],
    })
    .input(RegistrationStatusSchema)
    .output(z.object({ success: z.boolean() })),
};

// Export contract type for frontend
export type AuthContract = typeof authContract;

// Export typed client for backend-to-backend communication
export type AuthClient = ContractRouterClient<typeof authContract>;
