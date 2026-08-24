import { Button, Card } from '@sentinel/ui';
import type { CatalogItem } from '@sentinel/contracts';
import { rupees } from './money.js';

export interface ProductCardProps {
  item: CatalogItem;
  quantity: number;
  onAdjust: (delta: number) => void;
}

export function ProductCard({ item, quantity, onAdjust }: ProductCardProps): React.JSX.Element {
  return (
    <Card title={item.name}>
      <p className="shop__desc">{item.description}</p>
      <p className="shop__price">{rupees(item.pricePaise)}</p>
      <div className="shop__qty">
        <Button
          variant="secondary"
          onClick={() => onAdjust(-1)}
          aria-label={`Remove one ${item.name}`}
        >
          −
        </Button>
        <span aria-label={`${item.name} quantity`}>{quantity}</span>
        <Button variant="secondary" onClick={() => onAdjust(1)} aria-label={`Add one ${item.name}`}>
          +
        </Button>
      </div>
    </Card>
  );
}
