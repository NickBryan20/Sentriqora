import { InvalidIdempotencyKeyError } from './resource-errors';

const IDEMPOTENCY_KEY_PATTERN = /^[a-zA-Z0-9._:-]{8,128}$/u;

export class IdempotencyKey {
  private constructor(readonly value: string) {}

  static create(candidate: string | undefined): IdempotencyKey {
    const normalized = candidate?.trim() ?? '';
    if (!IDEMPOTENCY_KEY_PATTERN.test(normalized)) {
      throw new InvalidIdempotencyKeyError();
    }
    return new IdempotencyKey(normalized);
  }
}
