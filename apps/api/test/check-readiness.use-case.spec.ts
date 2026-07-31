import type { DependencyHealthPort } from '../src/health/application/ports/dependency-health.port';
import { CheckReadinessUseCase } from '../src/health/application/use-cases/check-readiness.use-case';
import { describe, expect, it } from 'vitest';

describe('CheckReadinessUseCase', () => {
  it('reports down when a required dependency is unavailable', async () => {
    const port: DependencyHealthPort = {
      check: async () => [
        { name: 'postgresql', status: 'up' },
        { name: 'redis', status: 'down' },
      ],
    };
    const useCase = new CheckReadinessUseCase(port, () => new Date('2026-07-31T12:00:00Z'));

    await expect(useCase.execute()).resolves.toMatchObject({
      status: 'down',
      timestamp: '2026-07-31T12:00:00.000Z',
    });
  });
});
