import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEventDefault from '@testing-library/user-event';
import { Button } from './Button.js';

const userEvent = userEventDefault;

describe('Button', () => {
  it('renders its label', () => {
    render(<Button>Run demo</Button>);
    expect(screen.getByRole('button', { name: 'Run demo' })).toBeInTheDocument();
  });

  it('defaults to type button so it never submits a form by accident', () => {
    render(<Button>Save</Button>);
    expect(screen.getByRole('button')).toHaveAttribute('type', 'button');
  });

  it('calls the handler when clicked', async () => {
    const onClick = vi.fn();
    render(<Button onClick={onClick}>Go</Button>);
    await userEvent.click(screen.getByRole('button'));
    expect(onClick).toHaveBeenCalledOnce();
  });

  it('does not fire when disabled', async () => {
    const onClick = vi.fn();
    render(
      <Button onClick={onClick} disabled>
        Go
      </Button>,
    );
    await userEvent.click(screen.getByRole('button'));
    expect(onClick).not.toHaveBeenCalled();
  });
});
