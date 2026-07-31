export type ApplicationErrorCode =
  | 'authentication_failed'
  | 'conflict'
  | 'csrf_failed'
  | 'forbidden'
  | 'invalid_mfa_code'
  | 'invalid_token'
  | 'not_found'
  | 'rate_limited'
  | 'session_reused'
  | 'service_unavailable'
  | 'validation_failed';

export class ApplicationError extends Error {
  constructor(
    public readonly code: ApplicationErrorCode,
    message: string,
    public readonly status: number,
  ) {
    super(message);
    this.name = 'ApplicationError';
  }
}
