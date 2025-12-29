import {
  os,
  authedProcedure,
  permissionMiddleware,
  zod,
} from "@checkmate/backend-api";
import {
  CreateHealthCheckConfigurationSchema,
  UpdateHealthCheckConfigurationSchema,
  AssociateHealthCheckSchema,
  permissions,
} from "@checkmate/healthcheck-common";
import { HealthCheckService } from "./service";
import { NodePgDatabase } from "drizzle-orm/node-postgres";
import * as schema from "./schema";

const healthCheckRead = permissionMiddleware(permissions.healthCheckRead.id);
const healthCheckManage = permissionMiddleware(
  permissions.healthCheckManage.id
);

export const router = os.router({
  getStrategies: authedProcedure
    .use(healthCheckRead)
    .handler(async ({ context }) => {
      return context.healthCheckRegistry.getStrategies().map((s) => ({
        id: s.id,
        displayName: s.displayName,
        description: s.description,
        configSchema: zod.toJSONSchema(s.configSchema),
      }));
    }),

  getConfigurations: authedProcedure
    .use(healthCheckRead)
    .handler(async ({ context }) => {
      const service = new HealthCheckService(
        context.db as unknown as NodePgDatabase<typeof schema>
      );
      return service.getConfigurations();
    }),

  createConfiguration: authedProcedure
    .use(healthCheckManage)
    .input(CreateHealthCheckConfigurationSchema)
    .handler(async ({ input, context }) => {
      const service = new HealthCheckService(
        context.db as unknown as NodePgDatabase<typeof schema>
      );
      return service.createConfiguration(input);
    }),

  updateConfiguration: authedProcedure
    .use(healthCheckManage)
    .input(
      zod.object({
        id: zod.string(),
        body: UpdateHealthCheckConfigurationSchema,
      })
    )
    .handler(async ({ input, context }) => {
      const service = new HealthCheckService(
        context.db as unknown as NodePgDatabase<typeof schema>
      );
      const config = await service.updateConfiguration(input.id, input.body);
      if (!config) throw new Error("Not found");
      return config;
    }),

  deleteConfiguration: authedProcedure
    .use(healthCheckManage)
    .input(zod.string())
    .handler(async ({ input, context }) => {
      const service = new HealthCheckService(
        context.db as unknown as NodePgDatabase<typeof schema>
      );
      await service.deleteConfiguration(input);
    }),

  getSystemConfigurations: authedProcedure
    .use(healthCheckRead)
    .input(zod.string())
    .handler(async ({ input, context }) => {
      const service = new HealthCheckService(
        context.db as unknown as NodePgDatabase<typeof schema>
      );
      return service.getSystemConfigurations(input);
    }),

  associateSystem: authedProcedure
    .use(healthCheckManage)
    .input(
      zod.object({ systemId: zod.string(), body: AssociateHealthCheckSchema })
    )
    .handler(async ({ input, context }) => {
      const service = new HealthCheckService(
        context.db as unknown as NodePgDatabase<typeof schema>
      );
      await service.associateSystem(
        input.systemId,
        input.body.configurationId,
        input.body.enabled
      );
    }),

  disassociateSystem: authedProcedure
    .use(healthCheckManage)
    .input(zod.object({ systemId: zod.string(), configId: zod.string() }))
    .handler(async ({ input, context }) => {
      const service = new HealthCheckService(
        context.db as unknown as NodePgDatabase<typeof schema>
      );
      await service.disassociateSystem(input.systemId, input.configId);
    }),

  getHistory: authedProcedure
    .use(healthCheckRead)
    .input(
      zod.object({
        systemId: zod.string().optional(),
        configurationId: zod.string().optional(),
        limit: zod.number().optional(),
      })
    )
    .handler(async ({ input, context }) => {
      const service = new HealthCheckService(
        context.db as unknown as NodePgDatabase<typeof schema>
      );
      return service.getHistory(input);
    }),
});

export type HealthCheckRouter = typeof router;
