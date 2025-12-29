// RPC Contract for auth-backend
// This defines the API surface that both backend and frontend use

export interface AuthRpcContract {
  // Permission management
  permissions: () => Promise<{ permissions: string[] }>;

  // User management
  getUsers: () => Promise<
    Array<{
      id: string;
      email: string;
      name: string;
      roles: string[];
    }>
  >;
  deleteUser: (userId: string) => Promise<void>;
  updateUserRoles: (input: {
    userId: string;
    roles: string[];
  }) => Promise<void>;

  // Role management
  getRoles: () => Promise<
    Array<{
      id: string;
      name: string;
      permissions: string[];
    }>
  >;

  // Authentication strategy management
  getStrategies: () => Promise<
    Array<{
      id: string;
      name: string;
      enabled: boolean;
    }>
  >;
  updateStrategy: (input: { id: string; enabled: boolean }) => Promise<void>;
}
