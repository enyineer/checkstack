import { oc } from "@orpc/contract";
import { z } from "zod";
import { pluginMetadata } from "./plugin-metadata";
import {
  createClientDefinition,
  type ProcedureMetadata,
} from "@checkstack/common";
import { integrationAccess } from "@checkstack/integration-common";
import {
  JiraConnectionRedactedSchema,
  CreateJiraConnectionInputSchema,
  UpdateJiraConnectionInputSchema,
  JiraProjectSchema,
  JiraIssueTypeSchema,
  JiraFieldSchema,
} from "./schemas";

// Base builder with full metadata support
const _base = oc.$meta<ProcedureMetadata>({});

/**
 * RPC contract for Jira-specific operations.
 * These endpoints are in addition to the generic integration endpoints.
 */
export const jiraContract = {
  // ==========================================================================
  // CONNECTION MANAGEMENT (Site-wide Jira configurations)
  // ==========================================================================

  /** List all Jira connections (redacted - no API tokens) */
  listConnections: _base
    .meta({
      userType: "user",
      access: [integrationAccess.manage],
    })
    .output(z.array(JiraConnectionRedactedSchema)),

  /** Get a single connection (redacted) */
  getConnection: _base
    .meta({
      userType: "user",
      access: [integrationAccess.manage],
    })
    .input(z.object({ id: z.string() }))
    .output(JiraConnectionRedactedSchema),

  /** Create a new Jira connection */
  createConnection: _base
    .meta({
      userType: "user",
      access: [integrationAccess.manage],
    })
    .input(CreateJiraConnectionInputSchema)
    .output(JiraConnectionRedactedSchema),

  /** Update a Jira connection */
  updateConnection: _base
    .meta({
      userType: "user",
      access: [integrationAccess.manage],
    })
    .input(UpdateJiraConnectionInputSchema)
    .output(JiraConnectionRedactedSchema),

  /** Delete a Jira connection */
  deleteConnection: _base
    .meta({
      userType: "user",
      access: [integrationAccess.manage],
    })
    .input(z.object({ id: z.string() }))
    .output(z.object({ success: z.boolean() })),

  /** Test a Jira connection */
  testConnection: _base
    .meta({
      userType: "user",
      access: [integrationAccess.manage],
    })
    .input(z.object({ id: z.string() }))
    .output(
      z.object({
        success: z.boolean(),
        message: z.string().optional(),
      })
    ),

  // ==========================================================================
  // JIRA API PROXIES (Fetch data from Jira using a connection)
  // ==========================================================================

  /** Get projects available in a Jira connection */
  getProjects: _base
    .meta({
      userType: "user",
      access: [integrationAccess.manage],
    })
    .input(z.object({ connectionId: z.string() }))
    .output(z.array(JiraProjectSchema)),

  /** Get issue types available for a project */
  getIssueTypes: _base
    .meta({
      userType: "user",
      access: [integrationAccess.manage],
    })
    .input(
      z.object({
        connectionId: z.string(),
        projectKey: z.string(),
      })
    )
    .output(z.array(JiraIssueTypeSchema)),

  /** Get fields available for a project and issue type */
  getFields: _base
    .meta({
      userType: "user",
      access: [integrationAccess.manage],
    })
    .input(
      z.object({
        connectionId: z.string(),
        projectKey: z.string(),
        issueTypeId: z.string(),
      })
    )
    .output(z.array(JiraFieldSchema)),

  /** Get priorities available in Jira */
  getPriorities: _base
    .meta({
      userType: "user",
      access: [integrationAccess.manage],
    })
    .input(z.object({ connectionId: z.string() }))
    .output(
      z.array(
        z.object({
          id: z.string(),
          name: z.string(),
          iconUrl: z.string().optional(),
        })
      )
    ),
};

// Export contract type
export type JiraContract = typeof jiraContract;

// Export client definition for type-safe forPlugin usage
export const JiraApi = createClientDefinition(jiraContract, pluginMetadata);
