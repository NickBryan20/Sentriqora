export const IDENTITY_POLICY = Symbol('IDENTITY_POLICY');

export interface IdentityPolicy {
  invitationTtlSeconds: number;
  mfaChallengeTtlSeconds: number;
  refreshTokenTtlSeconds: number;
}
