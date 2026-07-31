export const LOGIN_PROTECTION_PORT = Symbol('LOGIN_PROTECTION_PORT');

export interface LoginProtectionPort {
  assertAllowed(ipAddress: string, normalizedEmail: string): Promise<void>;
  recordFailure(ipAddress: string, normalizedEmail: string): Promise<void>;
  resetIdentity(normalizedEmail: string): Promise<void>;
}
