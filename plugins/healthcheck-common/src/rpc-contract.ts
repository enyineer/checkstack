import type {
  HealthCheckStrategyDto,
  HealthCheckConfiguration,
  CreateHealthCheckConfiguration,
  UpdateHealthCheckConfiguration,
  AssociateHealthCheck,
  HealthCheckRun,
} from "./index";

// RPC Contract for healthcheck-backend
// This defines the API surface that both backend and frontend use

export interface HealthCheckRpcContract {
  // Strategy management
  getStrategies: () => Promise<HealthCheckStrategyDto[]>;

  // Configuration management
  getConfigurations: () => Promise<HealthCheckConfiguration[]>;
  createConfiguration: (
    input: CreateHealthCheckConfiguration
  ) => Promise<HealthCheckConfiguration>;
  updateConfiguration: (input: {
    id: string;
    body: UpdateHealthCheckConfiguration;
  }) => Promise<HealthCheckConfiguration>;
  deleteConfiguration: (id: string) => Promise<void>;

  // System association
  getSystemConfigurations: (
    systemId: string
  ) => Promise<HealthCheckConfiguration[]>;
  associateSystem: (input: {
    systemId: string;
    body: AssociateHealthCheck;
  }) => Promise<void>;
  disassociateSystem: (input: {
    systemId: string;
    configId: string;
  }) => Promise<void>;

  // History
  getHistory: (params: {
    systemId?: string;
    configurationId?: string;
    limit?: number;
  }) => Promise<HealthCheckRun[]>;
}
