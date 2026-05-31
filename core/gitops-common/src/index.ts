export { pluginMetadata } from "./plugin-metadata";
export {
  entityEnvelopeSchema,
  entityMetadataSchema,
  CHECKSTACK_API_VERSION,
  type EntityEnvelope,
  type EntityMetadata,
} from "./entity-envelope";
export {
  SECRET_NAME_REGEX,
  SECRET_TEMPLATE_REGEX,
  secretNameSchema,
  secretTemplateSchema,
  collectSecretNames,
} from "./secret-field";
export {
  entityRefSchema,
  extractEntityRefs,
  type EntityRef,
} from "./entity-ref";
export {
  type EntityKindDefinition,
  type EntityKindExtensionDefinition,
  type EntityKindRegistry,
  type ReconcileContext,
  type SpecSchemaDocumentation,
  type SpecSchemaDocumentationProvider,
} from "./entity-kind-registry";
export { gitopsAccess, gitopsAccessRules } from "./access";
export { gitopsRoutes } from "./routes";
export {
  provenanceSchema,
  provenanceStatusSchema,
  deletionPolicySchema,
  type Provenance,
  type ProvenanceStatus,
  type DeletionPolicy,
} from "./provenance-types";
export { gitopsContract, GitOpsApi, type GitOpsContract } from "./rpc-contract";
export {
  deriveSourceUrl,
  type DeriveSourceUrlInput,
} from "./source-url";
