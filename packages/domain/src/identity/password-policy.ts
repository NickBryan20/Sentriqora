import { WeakPasswordError } from './identity-errors';

const COMMON_PASSWORDS = new Set([
  '12345678901234',
  'admin123456789',
  'contraseña12345',
  'password123456',
  'qwerty123456789',
  'welcome1234567',
]);

export class PasswordPolicy {
  static readonly minimumLength = 14;
  static readonly maximumLength = 128;

  validate(candidate: string, identityHints: readonly string[] = []): string {
    const password = candidate.normalize('NFC');
    const length = [...password].length;
    const normalized = password.toLocaleLowerCase('en-US');
    const reasons: string[] = [];

    if (length < PasswordPolicy.minimumLength) {
      reasons.push('minimum_length');
    }
    if (length > PasswordPolicy.maximumLength) {
      reasons.push('maximum_length');
    }
    if (COMMON_PASSWORDS.has(normalized)) {
      reasons.push('common_password');
    }
    if (
      identityHints.some((hint) => {
        const normalizedHint = hint.trim().toLocaleLowerCase('en-US');
        return normalizedHint.length >= 4 && normalized.includes(normalizedHint);
      })
    ) {
      reasons.push('contains_identity');
    }

    if (reasons.length > 0) {
      throw new WeakPasswordError(reasons);
    }

    return password;
  }
}
