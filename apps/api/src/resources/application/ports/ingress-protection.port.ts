export const INGRESS_PROTECTION_PORT = Symbol('INGRESS_PROTECTION_PORT');

export interface IngressProtectionPort {
  assertAllowed(input: {
    connectorId: string;
    credential: string;
    ipAddress: string;
    organizationId: string;
  }): Promise<void>;
}
