import type { HealthResponse } from '@aegisflow/contracts';

import type { DependencyHealthPort } from '../ports/dependency-health.port';

export class CheckReadinessUseCase {
  constructor(
    private readonly dependencies: DependencyHealthPort,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async execute(): Promise<HealthResponse> {
    const components = await this.dependencies.check();
    const status = components.every((component) => component.status === 'up') ? 'up' : 'down';

    return {
      components,
      service: 'aegisflow-api',
      status,
      timestamp: this.now().toISOString(),
      version: '0.1.0',
    };
  }
}
