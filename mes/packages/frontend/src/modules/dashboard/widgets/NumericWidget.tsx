import { formatLiveValue, type LiveTagValue } from '../../plc-gateway/hooks/usePlcLiveData';
import type { WidgetConfig } from '../../recipe/services/recipe.service';

interface Props {
  widget: WidgetConfig;
  live?: LiveTagValue;
}

/** Büyük sayısal gösterge — canlı tag değeri + birim. */
export default function NumericWidget({ widget, live }: Props) {
  const decimals = widget.options.decimals ?? 2;
  let text = '—';
  if (live?.value !== null && live?.value !== undefined) {
    if (typeof live.value === 'number') {
      text = live.value.toFixed(decimals);
    } else {
      text = formatLiveValue(live.value);
    }
  }

  const bad = live?.quality === 'bad';

  return (
    <div className="wv-numeric">
      <div className={`wv-numeric-value${bad ? ' wv-bad' : ''}`}>
        {text}
        {widget.options.unit && <span className="wv-numeric-unit">{widget.options.unit}</span>}
      </div>
    </div>
  );
}
