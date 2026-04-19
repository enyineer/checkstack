import { parseAllDocuments } from "yaml";
import { entityEnvelopeSchema } from "@checkstack/gitops-common";
import { extractErrorMessage } from "@checkstack/common";
import type { EntityEnvelope } from "@checkstack/gitops-common";

/**
 * A successfully parsed entity with its content hash for diffing.
 */
export interface ParsedEntity {
  /** The validated entity envelope. */
  entity: EntityEnvelope;
  /** SHA-256 hex hash of the raw YAML source for this entity. */
  contentHash: string;
}

/**
 * An error encountered during parsing or validation.
 */
export interface ParseError {
  /** 0-based document index within the YAML file. */
  documentIndex: number;
  /** Human-readable error message. */
  message: string;
}

/**
 * Result of parsing a YAML file containing one or more entity documents.
 */
export interface ParseResult {
  entities: ParsedEntity[];
  errors: ParseError[];
}

/**
 * Parses a YAML string (potentially multi-document) into entity envelopes.
 * Never throws — all parse/validation errors are collected in `errors`.
 *
 * @param content - Raw YAML content (may contain multiple docs separated by `---`)
 * @returns Parsed entities and any errors encountered
 */
export function parseEntityDocuments(params: { content: string }): ParseResult {
  const { content } = params;
  const entities: ParsedEntity[] = [];
  const errors: ParseError[] = [];

  let docs: ReturnType<typeof parseAllDocuments>;
  try {
    docs = parseAllDocuments(content);
  } catch (error) {
    errors.push({
      documentIndex: 0,
      message: `Failed to parse YAML: ${extractErrorMessage(error, "Unknown error")}`,
    });
    return { entities, errors };
  }

  for (const [i, doc] of docs.entries()) {
    // Check for YAML-level parse errors
    if (doc.errors.length > 0) {
      errors.push({
        documentIndex: i,
        message: `YAML parse error: ${doc.errors.map((e) => e.message).join("; ")}`,
      });
      continue;
    }

    const raw = doc.toJSON();

    // Skip null/empty documents (e.g., trailing `---`)
    if (raw === null || raw === undefined) {
      continue;
    }

    // Validate against entity envelope schema
    const result = entityEnvelopeSchema.safeParse(raw);
    if (!result.success) {
      const issues = result.error.issues
        .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
        .join("; ");
      errors.push({
        documentIndex: i,
        message: `Validation error: ${issues}`,
      });
      continue;
    }

    // Compute content hash from the raw YAML source for this document
    const docSource = extractDocumentSource({ content, documentIndex: i });
    const contentHash = computeHash({ input: docSource });

    entities.push({ entity: result.data, contentHash });
  }

  return { entities, errors };
}

/**
 * Extracts the raw YAML source for a single document from a multi-doc string.
 * Uses `---` as the separator.
 */
function extractDocumentSource(params: {
  content: string;
  documentIndex: number;
}): string {
  const { content, documentIndex } = params;
  // Split on document separators, handling leading `---`
  const parts = content.split(/^---$/m);

  // If the content starts with `---`, the first part is empty
  const nonEmptyParts = parts[0].trim() === "" ? parts.slice(1) : parts;

  return (nonEmptyParts[documentIndex] ?? "").trim();
}

/**
 * Computes a SHA-256 hex hash of a string.
 */
function computeHash(params: { input: string }): string {
  const hasher = new Bun.CryptoHasher("sha256");
  hasher.update(params.input);
  return hasher.digest("hex");
}

export { computeHash };
