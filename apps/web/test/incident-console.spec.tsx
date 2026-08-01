import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { IncidentConsole } from '../src/components/incident-console';

describe('IncidentConsole', () => {
  it('explains tenant selection before requesting incident data', () => {
    render(<IncidentConsole organizationId={null} />);
    expect(screen.getByRole('heading', { name: /Selecciona una organización/i })).toBeTruthy();
    expect(screen.getByText(/comprobar tenant y permisos/i)).toBeTruthy();
  });
});
