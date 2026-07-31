export class IdentityDomainError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = new.target.name;
  }
}

export class InvalidEmailError extends IdentityDomainError {
  constructor() {
    super('invalid_email', 'The email address is invalid.');
  }
}

export class InvalidOrganizationSlugError extends IdentityDomainError {
  constructor() {
    super('invalid_organization_slug', 'The organization slug is invalid.');
  }
}

export class WeakPasswordError extends IdentityDomainError {
  constructor(public readonly reasons: readonly string[]) {
    super('weak_password', 'The password does not satisfy the security policy.');
  }
}
