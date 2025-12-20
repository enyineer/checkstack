/**
 * Represents a permission that can be assigned to roles.
 * The id will be prefixed with the plugin name when registered.
 */
export type Permission = {
  /** Permission identifier (e.g., "read-things", will become "pluginId.read-things") */
  id: string;
  /** Human-readable description of what this permission allows */
  description?: string;
};
