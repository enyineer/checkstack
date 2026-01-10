import type { TransportClient } from "@checkstack/common";

/**
 * TLS inspection request.
 */
export interface TlsInspectRequest {
  /** Action to perform (inspect is the default and only action for now) */
  action?: "inspect";
}

/**
 * TLS certificate information.
 */
export interface TlsCertificateInfo {
  isValid: boolean;
  isSelfSigned: boolean;
  issuer: string;
  subject: string;
  validFrom: string;
  validTo: string;
  daysUntilExpiry: number;
  daysRemaining: number; // Alias for daysUntilExpiry
  protocol?: string;
  cipher?: string;
  error?: string;
}

/**
 * TLS transport client for certificate inspection.
 */
export type TlsTransportClient = TransportClient<
  TlsInspectRequest,
  TlsCertificateInfo
>;
