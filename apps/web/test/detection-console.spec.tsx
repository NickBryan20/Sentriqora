import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { DetectionConsole } from '../src/components/detection-console';

describe('DetectionConsole', () => {
  it('explains the secure tenant selection when no organization is present', () => {
    render(<DetectionConsole organizationId={null} />);
    expect(screen.getByRole('heading', { name: /Selecciona una organización/i })).toBeTruthy();
    expect(screen.getByText(/API vuelve a validar la sesión/i)).toBeTruthy();
  });
});
