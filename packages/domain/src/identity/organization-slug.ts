import { InvalidOrganizationSlugError } from './identity-errors';

const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;

export class OrganizationSlug {
  private constructor(public readonly value: string) {}

  static create(candidate: string): OrganizationSlug {
    const value = candidate
      .trim()
      .normalize('NFKD')
      .replace(/[\u0300-\u036f]/gu, '')
      .toLocaleLowerCase('en-US')
      .replace(/[^a-z0-9]+/gu, '-')
      .replace(/^-|-$/gu, '');

    if (value.length < 2 || value.length > 80 || !SLUG_PATTERN.test(value)) {
      throw new InvalidOrganizationSlugError();
    }

    return new OrganizationSlug(value);
  }
}
