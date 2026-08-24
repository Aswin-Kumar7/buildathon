import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Badge } from './Badge.js';

describe('Badge', () => {
  it('renders its content', () => {
    render(<Badge>ready</Badge>);
    expect(screen.getByText('ready')).toBeInTheDocument();
  });

  it('defaults to the neutral tone', () => {
    render(<Badge>idle</Badge>);
    expect(screen.getByText('idle')).toHaveClass('s-badge--neutral');
  });

  it('applies the requested tone', () => {
    render(<Badge tone="critical">blocked</Badge>);
    expect(screen.getByText('blocked')).toHaveClass('s-badge--critical');
  });
});
