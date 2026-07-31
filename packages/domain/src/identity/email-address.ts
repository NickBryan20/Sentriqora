import { InvalidEmailError } from './identity-errors';

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/u;

export class EmailAddress {
  private constructor(
    public readonly value: string,
    public readonly normalized: string,
  ) {}

  static create(candidate: string): EmailAddress {
    const value = candidate.trim().normalize('NFC');
    const normalized = value.toLocaleLowerCase('en-US');

    if (value.length > 254 || !EMAIL_PATTERN.test(value)) {
      throw new InvalidEmailError();
    }

    return new EmailAddress(value, normalized);
  }
}
