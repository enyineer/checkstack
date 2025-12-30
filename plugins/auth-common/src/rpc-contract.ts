import { oc } from "@orpc/contract";
import type { ContractRouterClient } from "@orpc/contract";
import { z } from "zod";
import { permissions } from "./index";

// Permission metadata type
export interface AuthMetadata {
  permissions?: string[];
}

// Base builder with metadata support
const _base = oc.$meta<AuthMetadata>({});

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
  permissions: z.array(z.string()),
  isSystem: z.boolean().optional(),
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

// Auth RPC Contract with permission metadata
export const authContract = {
  // Public endpoint - No authentication required (for login page)
  getEnabledStrategies: _base
    .meta({ permissions: [] }) // Public endpoint
    .output(z.array(EnabledStrategyDtoSchema)),

  // Permission query - Authenticated only (no specific permission required)
  permissions: _base
    .meta({ permissions: [] }) // Anyone authenticated can check their own permissions
    .output(z.object({ permissions: z.array(z.string()) })),

  // User management - Read permission for queries, Manage for mutations
  getUsers: _base
    .meta({ permissions: [permissions.usersRead.id] })
    .output(z.array(UserDtoSchema)),

  deleteUser: _base
    .meta({ permissions: [permissions.usersManage.id] })
    .input(z.string())
    .output(z.void()),

  updateUserRoles: _base
    .meta({ permissions: [permissions.usersManage.id] })
    .input(
      z.object({
        userId: z.string(),
        roles: z.array(z.string()),
      })
    )
    .output(z.void()),

  // Role management - Read, Create, Update, Delete permissions
  getRoles: _base
    .meta({ permissions: [permissions.rolesRead.id] })
    .output(z.array(RoleDtoSchema)),

  getPermissions: _base
    .meta({ permissions: [permissions.rolesRead.id] })
    .output(z.array(PermissionDtoSchema)),

  createRole: _base
    .meta({ permissions: [permissions.rolesCreate.id] })
    .input(
      z.object({
        name: z.string(),
        description: z.string().optional(),
        permissions: z.array(z.string()),
      })
    )
    .output(z.void()),

  updateRole: _base
    .meta({ permissions: [permissions.rolesUpdate.id] })
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
    .meta({ permissions: [permissions.rolesDelete.id] })
    .input(z.string())
    .output(z.void()),

  getStrategies: _base
    .meta({ permissions: [permissions.strategiesManage.id] })
    .output(z.array(StrategyDtoSchema)),

  updateStrategy: _base
    .meta({ permissions: [permissions.strategiesManage.id] })
    .input(
      z.object({
        id: z.string(),
        enabled: z.boolean(),
        config: z.record(z.string(), z.unknown()).optional(),
      })
    )
    .output(z.object({ success: z.boolean() })),

  reloadAuth: _base
    .meta({ permissions: [permissions.strategiesManage.id] })
    .output(z.object({ success: z.boolean() })),

  // Registration management
  getRegistrationStatus: _base
    .meta({ permissions: [] }) // Public endpoint
    .output(RegistrationStatusSchema),

  setRegistrationStatus: _base
    .meta({ permissions: [permissions.registrationManage.id] })
    .input(z.object({ allowRegistration: z.boolean() }))
    .output(z.object({ success: z.boolean() })),
};

// Export contract type for frontend
export type AuthContract = typeof authContract;

// Export typed client for backend-to-backend communication
export type AuthClient = ContractRouterClient<typeof authContract>;
