import { z } from "zod";

// Domain type schemas for catalog entities
// These match the database output types exactly
// JSON serialization will handle Date -> ISO string conversion automatically

export const SystemSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  metadata: z.record(z.string(), z.unknown()).nullable(),
  createdAt: z.date(),
  updatedAt: z.date(),
});
export type System = z.infer<typeof SystemSchema>;

// Contact Types
export const ContactTypeSchema = z.enum(["user", "mailbox"]);
export type ContactType = z.infer<typeof ContactTypeSchema>;

// Base fields shared by all contacts
const SystemContactBaseSchema = z.object({
  id: z.string(),
  systemId: z.string(),
  label: z.string().nullable(),
  createdAt: z.date(),
});

// User contact: requires userId, includes resolved profile
const UserContactSchema = SystemContactBaseSchema.extend({
  type: z.literal("user"),
  userId: z.string(),
  userName: z.string().optional(),
  userEmail: z.string().optional(),
});

// Mailbox contact: requires email
const MailboxContactSchema = SystemContactBaseSchema.extend({
  type: z.literal("mailbox"),
  email: z.string(),
});

export const SystemContactSchema = z.discriminatedUnion("type", [
  UserContactSchema,
  MailboxContactSchema,
]);
export type SystemContact = z.infer<typeof SystemContactSchema>;

// System Links — free-form hotlinks attached to a system (Jira board, dashboards, etc.)
export const SystemLinkSchema = z.object({
  id: z.string(),
  systemId: z.string(),
  label: z.string().nullable(),
  url: z.string(),
  createdAt: z.date(),
});
export type SystemLink = z.infer<typeof SystemLinkSchema>;

export const GroupSchema = z.object({
  id: z.string(),
  name: z.string(),
  systemIds: z.array(z.string()), // Required field from the service layer
  /** Persisted browse order (lower sorts first). */
  sortOrder: z.number(),
  metadata: z.record(z.string(), z.unknown()).nullable(),
  createdAt: z.date(),
  updatedAt: z.date(),
});
export type Group = z.infer<typeof GroupSchema>;

export const EnvironmentSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  systemIds: z.array(z.string()), // Required field from the service layer
  metadata: z.record(z.string(), z.unknown()).nullable(),
  createdAt: z.date(),
  updatedAt: z.date(),
});
export type Environment = z.infer<typeof EnvironmentSchema>;

export const CreateEnvironmentSchema = z.object({
  name: z.string().trim().min(1).max(200),
  description: z.string().optional(),
  metadata: z
    .record(z.string(), z.unknown())
    .optional()
    .describe(
      "Free-form key/value custom fields for this environment (e.g. baseUrl, region, tier). Each key becomes available in the health-check config templates of systems assigned to this environment as `{{ environment.<key> }}` - e.g. set `baseUrl` so a check's URL can reference `{{ environment.baseUrl }}`. Only set keys the user explicitly asks to store; do not invent keys.",
    ),
});
export type CreateEnvironment = z.infer<typeof CreateEnvironmentSchema>;

export const UpdateEnvironmentSchema = CreateEnvironmentSchema.partial();
export type UpdateEnvironment = z.infer<typeof UpdateEnvironmentSchema>;

export const ViewSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  configuration: z.unknown(),
  createdAt: z.date(),
  updatedAt: z.date(),
});
export type View = z.infer<typeof ViewSchema>;
