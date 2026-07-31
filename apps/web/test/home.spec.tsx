import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import Home from '../app/page';

describe('bootstrap page', () => {
  it('identifies the platform and the active phase', () => {
    render(<Home />);

    expect(screen.getByRole('heading', { name: /AegisFlow/i })).toBeTruthy();
    expect(screen.getByText(/Fase 0/i)).toBeTruthy();
  });
});
