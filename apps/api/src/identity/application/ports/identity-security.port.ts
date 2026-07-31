import type { AuthPrincipal } from '@aegisflow/contracts';

export const IDENTITY_SECURITY_PORT = Symbol('IDENTITY_SECURITY_PORT');

export interface EncryptedValue {
  authTag: string;
  ciphertext: string;
  iv: string;
}

export interface IssuedOpaqueToken {
  hash: string;
  plainText: string;
}

export interface RecoveryCodeSet {
  hashes: readonly string[];
  plainTextCodes: readonly string[];
}

export interface IdentitySecurityPort {
  decrypt(value: EncryptedValue): string;
  encrypt(value: string): EncryptedValue;
  generateId(): string;
  generateOpaqueToken(): IssuedOpaqueToken;
  generateRecoveryCodes(count: number): RecoveryCodeSet;
  generateTotpSecret(): string;
  hashFingerprint(value: string): string;
  hashOpaqueToken(value: string): string;
  hashPassword(password: string): Promise<string>;
  issueAccessToken(principal: AuthPrincipal): string;
  verifyAccessToken(token: string): AuthPrincipal;
  verifyPassword(passwordHash: string, password: string): Promise<boolean>;
  verifyTotp(secret: string, code: string, now: Date): bigint | null;
}
