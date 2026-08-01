import { InvalidResourceKeyError } from './resource-errors';

const RESOURCE_KEY_PATTERN = /^[a-z][a-z0-9._-]{1,63}$/u;

export class ResourceKey {
  private constructor(readonly value: string) {}

  static create(candidate: string): ResourceKey {
    const normalized = candidate.trim().toLocaleLowerCase('en-US');
    if (!RESOURCE_KEY_PATTERN.test(normalized)) {
      throw new InvalidResourceKeyError();
    }
    return new ResourceKey(normalized);
  }
}
