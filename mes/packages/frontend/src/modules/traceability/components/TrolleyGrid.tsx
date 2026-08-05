import { useTranslation } from 'react-i18next';
import { Badge } from '../../../core/components/common';
import type { TrolleyContext, TrolleyProductItem } from '../services/trace.service';

/**
 * TrolleyGrid — arabanın slot yerleşim ızgarası (4 sütun x N satır, CSS'te).
 * Slot'a tıklanınca onSlotClick çağrılır (detay/ölçüm pop-up'ı için).
 */

interface Props {
  trolley: TrolleyContext;
  items?: TrolleyProductItem[];
  onSlotClick?: (slotNumber: number, item: TrolleyProductItem | undefined) => void;
}

export default function TrolleyGrid({ trolley, items = [], onSlotClick }: Props) {
  const { t } = useTranslation();
  return (
    <div className="trace-sim-grid">
      {Array.from({ length: trolley.slotCount }, (_, i) => {
        const slotNumber = i + 1;
        const item = items.find((x) => x.slotNumber === slotNumber);
        const productId = item?.productId ?? trolley.slots.find((s) => s.slot_number === slotNumber)?.product_id;
        const filled = Boolean(productId);
        return (
          <div
            key={slotNumber}
            className={`trace-sim-slot${filled ? ' filled' : ''}`}
            onClick={() => onSlotClick?.(slotNumber, item)}
            title={filled ? `#${slotNumber} — ${productId}` : `#${slotNumber} — ${t('trace.emptySlot')}`}
          >
            <div className="trace-sim-slot-num">#{slotNumber}</div>
            {filled ? (
              <div className="trace-sim-slot-product">{productId}</div>
            ) : (
              <Badge variant="muted">{t('trace.emptySlot')}</Badge>
            )}
          </div>
        );
      })}
    </div>
  );
}
