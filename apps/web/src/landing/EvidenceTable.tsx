import { Badge, Table } from '@sentinel/ui';
import type { EvidenceLayer, EvidenceStatus } from '@sentinel/contracts';

const TONE: Record<EvidenceStatus, 'neutral' | 'warn' | 'ok'> = {
  'not-started': 'neutral',
  'in-progress': 'warn',
  ready: 'ok',
};

const LABEL: Record<EvidenceStatus, string> = {
  'not-started': 'not started',
  'in-progress': 'in progress',
  ready: 'ready',
};

export function EvidenceTable({ layers }: { layers: EvidenceLayer[] }): React.JSX.Element {
  return (
    <Table caption="Three layers, never blended. Status is read from the running API.">
      <thead>
        <tr>
          <th scope="col">Layer</th>
          <th scope="col">Source</th>
          <th scope="col">What it proves</th>
          <th scope="col">Status</th>
        </tr>
      </thead>
      <tbody>
        {layers.map((layer) => (
          <tr key={layer.id}>
            <th scope="row">
              {layer.id} — {layer.name}
            </th>
            <td>{layer.source}</td>
            <td>{layer.proves}</td>
            <td>
              <Badge tone={TONE[layer.status]}>{LABEL[layer.status]}</Badge>{' '}
              <span className="muted">{layer.arrivesIn}</span>
            </td>
          </tr>
        ))}
      </tbody>
    </Table>
  );
}
