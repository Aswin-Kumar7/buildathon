import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Table } from './Table.js';

describe('Table', () => {
  it('renders rows inside a table element', () => {
    render(
      <Table>
        <tbody>
          <tr>
            <td>L1</td>
          </tr>
        </tbody>
      </Table>,
    );
    expect(screen.getByRole('table')).toBeInTheDocument();
    expect(screen.getByRole('cell', { name: 'L1' })).toBeInTheDocument();
  });

  it('renders a caption when given one', () => {
    render(
      <Table caption="Evidence layers">
        <tbody>
          <tr>
            <td>x</td>
          </tr>
        </tbody>
      </Table>,
    );
    expect(screen.getByText('Evidence layers')).toBeInTheDocument();
  });
});
