/**
 * Simple template engine for expanding {{payload.property}} placeholders.
 * Supports nested property access (e.g., {{payload.system.name}}).
 * Missing values are rendered as the original placeholder for easier debugging.
 */

/**
 * Get a nested property value from an object using dot notation.
 * @param obj The object to retrieve from
 * @param path The dot-separated path (e.g., "system.name")
 * @returns The value at the path, or undefined if not found
 */
function getNestedValue(obj: Record<string, unknown>, path: string): unknown {
  const parts = path.split(".");
  let current: unknown = obj;

  for (const part of parts) {
    if (current === null || current === undefined) {
      return undefined;
    }
    if (typeof current !== "object") {
      return undefined;
    }
    current = (current as Record<string, unknown>)[part];
  }

  return current;
}

/**
 * Expand a template string using values from the payload.
 *
 * @param template The template string (e.g., "Alert: {{payload.title}}")
 * @param payload The payload object containing replacement values
 * @returns The expanded string with placeholders replaced
 *
 * @example
 * expandTemplate("Issue: {{payload.title}}", { title: "Server down" })
 * // Returns: "Issue: Server down"
 *
 * @example
 * expandTemplate("{{payload.missing}}", {})
 * // Returns: "{{payload.missing}}" (original placeholder for debugging)
 */
export function expandTemplate(
  template: string,
  payload: Record<string, unknown>,
): string {
  // Match {{payload.path.to.value}} patterns
  const pattern = /\{\{payload\.([^}]+)\}\}/g;

  return template.replaceAll(pattern, (match, path: string) => {
    const value = getNestedValue(payload, path);

    // If value is missing, return original placeholder for debugging
    if (value === undefined || value === null) {
      return match;
    }

    // Convert to string
    if (typeof value === "object") {
      return JSON.stringify(value);
    }

    return String(value);
  });
}

/**
 * Check if a template contains any placeholders.
 */
export function hasPlaceholders(template: string): boolean {
  return /\{\{payload\.[^}]+\}\}/.test(template);
}

/**
 * Extract all placeholder paths from a template.
 */
export function extractPlaceholders(template: string): string[] {
  const pattern = /\{\{payload\.([^}]+)\}\}/g;
  const paths: string[] = [];
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(template)) !== null) {
    paths.push(match[1]);
  }

  return paths;
}
