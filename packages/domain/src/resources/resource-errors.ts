export class ResourceDomainError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = new.target.name;
  }
}

export class InvalidResourceKeyError extends ResourceDomainError {
  constructor() {
    super('invalid_resource_key', 'The resource key is invalid.');
  }
}

export class InvalidDependencyError extends ResourceDomainError {
  constructor() {
    super('invalid_asset_dependency', 'An asset cannot depend on itself.');
  }
}

export class InvalidConnectorConfigurationError extends ResourceDomainError {
  constructor(readonly reasons: readonly string[]) {
    super('invalid_connector_configuration', 'The connector configuration is invalid.');
  }
}

export class InvalidIdempotencyKeyError extends ResourceDomainError {
  constructor() {
    super('invalid_idempotency_key', 'The idempotency key is invalid.');
  }
}

export class InvalidApiKeyPolicyError extends ResourceDomainError {
  constructor(readonly reasons: readonly string[]) {
    super('invalid_api_key_policy', 'The API key policy is invalid.');
  }
}
