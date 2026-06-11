import {
  pluginMetadata,
  TextConfigSchema,
  TextDtoSchema,
  HeadingConfigSchema,
  HeadingDtoSchema,
  LinksConfigSchema,
  LinksDtoSchema,
  ImageConfigSchema,
  ImageDtoSchema,
  DividerConfigSchema,
  DividerDtoSchema,
} from "@checkstack/status-page-common";
import type {
  WidgetTypeDefinition,
  WidgetTypeRegistry,
} from "./widget-registry";

/**
 * The CONTENT widgets — the only built-ins the status-page platform owns,
 * because they bind no domain resources (their config IS their public DTO).
 * The domain widgets (system health, uptime, incidents, maintenance, ...) are
 * contributed by their OWNING plugins via `statusWidgetTypeExtensionPoint`, so
 * this package never depends on catalog/healthcheck/incident/maintenance.
 */
function staticWidget({
  id,
  displayName,
  description,
  configSchema,
  dtoSchema,
}: {
  id: string;
  displayName: string;
  description: string;
  configSchema: WidgetTypeDefinition["configSchema"];
  dtoSchema: WidgetTypeDefinition["dtoSchema"];
}): WidgetTypeDefinition {
  return {
    id,
    displayName,
    description,
    category: "Content",
    binding: "none",
    configSchema,
    dtoSchema,
    boundResources: () => [],
    async resolvePublic({ config }) {
      return dtoSchema.parse(configSchema.parse(config));
    },
  };
}

/** Register the content widgets the platform owns directly. */
export function registerContentWidgets(registry: WidgetTypeRegistry): void {
  const widgets: WidgetTypeDefinition[] = [
    staticWidget({
      id: "text",
      displayName: "Text",
      description: "A Markdown text block (rendered sanitized).",
      configSchema: TextConfigSchema,
      dtoSchema: TextDtoSchema,
    }),
    staticWidget({
      id: "heading",
      displayName: "Heading",
      description: "A section heading.",
      configSchema: HeadingConfigSchema,
      dtoSchema: HeadingDtoSchema,
    }),
    staticWidget({
      id: "links",
      displayName: "Links",
      description: "A list of labelled links.",
      configSchema: LinksConfigSchema,
      dtoSchema: LinksDtoSchema,
    }),
    staticWidget({
      id: "image",
      displayName: "Image / logo",
      description: "An image (e.g. your logo).",
      configSchema: ImageConfigSchema,
      dtoSchema: ImageDtoSchema,
    }),
    staticWidget({
      id: "divider",
      displayName: "Divider",
      description: "A horizontal divider.",
      configSchema: DividerConfigSchema,
      dtoSchema: DividerDtoSchema,
    }),
  ];
  for (const w of widgets) registry.register(w, pluginMetadata);
}
