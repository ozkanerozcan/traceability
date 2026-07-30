import { useTranslation } from 'react-i18next';
import type { LiveTagValue } from '../../plc-gateway/hooks/usePlcLiveData';
import type { WidgetConfig } from '../../recipe/services/recipe.service';

interface Props {
  widget: WidgetConfig;
  live?: LiveTagValue;
}

/** Yeşil/kırmızı durum LED'i — boolean veya sayısal (0/1) değer. */
export default function StatusWidget({ widget, live }: Props) {
  const { t } = useTranslation();
  const trueLabel = widget.options.trueLabel || t('recipe.config.trueLabelDefault');
  const falseLabel = widget.options.falseLabel || t('recipe.config.falseLabelDefault');

  let on: boolean | null = null;
  if (typeof live?.value === 'boolean') on = live.value;
  else if (typeof live?.value === 'number') on = live.value !== 0;
  else if (typeof live?.value === 'string') on = live.value.length > 0 && live.value !== '0';

  return (
    <div className="wv-status">
      <span className={`wv-status-dot ${on === null ? 'unknown' : on ? 'on' : 'off'}`} />
      <span className="wv-status-label">
        {on === null ? '—' : on ? trueLabel : falseLabel}
      </span>
    </div>
  );
}
