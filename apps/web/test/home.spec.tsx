import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import Home from '../app/page';

describe('platform home page', () => {
  it('identifies the platform and the active phase', () => {
    render(<Home />);

    expect(screen.getByRole('heading', { name: /AegisFlow/i })).toBeTruthy();
    expect(screen.getByText(/Fase 4/i)).toBeTruthy();
  });
});
