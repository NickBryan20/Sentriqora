import type { ComponentHealth } from '@aegisflow/contracts';

export const DEPENDENCY_HEALTH_PORT = Symbol('DependencyHealthPort');

export interface DependencyHealthPort {
  check(): Promise<ComponentHealth[]>;
}
