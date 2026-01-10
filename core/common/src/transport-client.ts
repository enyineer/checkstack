/**
 * Generic transport client interface for remote command execution.
 *
 * Transport strategies (SSH, SNMP, WinRM) implement this interface to provide
 * a consistent abstraction for collectors.
 *
 * @template TCommand - Command type (e.g., string for SSH, OidRequest for SNMP)
 * @template TResult - Result type (e.g., { stdout, stderr, exitCode } for SSH)
 */
export interface TransportClient<TCommand, TResult> {
  /**
   * Execute a command on the remote host.
   * The command and result types are defined by the transport implementation.
   */
  exec(command: TCommand): Promise<TResult>;
}
