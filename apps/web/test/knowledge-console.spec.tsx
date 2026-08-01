import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { KnowledgeConsole } from '../src/components/knowledge-console';

describe('KnowledgeConsole', () => {
  it('requires a tenant before rendering mutating controls', () => {
    render(<KnowledgeConsole organizationId={null} />);
    expect(screen.getByText('Selecciona una organización')).toBeTruthy();
    expect(screen.queryByText('Indexar documento')).toBeNull();
  });

  it('renders source and abstention-oriented controls for a tenant', () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ json: async () => [], ok: true }));
    render(<KnowledgeConsole organizationId="00000000-0000-4000-8000-000000000001" />);
    expect(screen.getByText('Añadir procedimiento')).toBeTruthy();
    expect(screen.getByText('Consultar evidencia')).toBeTruthy();
    vi.unstubAllGlobals();
  });
});
