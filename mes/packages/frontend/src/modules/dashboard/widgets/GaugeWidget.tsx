import type { LiveTagValue } from '../../plc-gateway/hooks/usePlcLiveData';
import type { WidgetConfig } from '../../recipe/services/recipe.service';

interface Props {
  widget: WidgetConfig;
  live?: LiveTagValue;
}

/** İbreli gösterge — custom SVG yay gauge (bağımlılık yok). */
export default function GaugeWidget({ widget, live }: Props) {
  const min = widget.options.min ?? 0;
  const max = widget.options.max ?? 100;
  const warn = widget.options.warningHigh;
  const decimals = widget.options.decimals ?? 1;

  const raw = typeof live?.value === 'number' ? live.value : null;
  const clamped = raw === null ? null : Math.min(max, Math.max(min, raw));
  const ratio = clamped === null || max === min ? 0 : (clamped - min) / (max - min);

  // 240° yay: -210° → 30°
  const startAngle = -210;
  const endAngle = 30;
  const angle = startAngle + ratio * (endAngle - startAngle);
  const over = warn !== undefined && raw !== null && raw >= warn;

  const polar = (deg: number, r: number) => {
    const rad = (deg * Math.PI) / 180;
    return { x: 50 + r * Math.cos(rad), y: 50 + r * Math.sin(rad) };
  };
  const arc = (from: number, to: number, r: number) => {
    const a = polar(from, r);
    const b = polar(to, r);
    const large = Math.abs(to - from) > 180 ? 1 : 0;
    return `M ${a.x} ${a.y} A ${r} ${r} 0 ${large} 1 ${b.x} ${b.y}`;
  };

  const needle = polar(angle, 30);

  return (
    <div className="wv-gauge">
      <svg viewBox="0 0 100 78" className="wv-gauge-svg">
        <path d={arc(startAngle, endAngle, 40)} className="wv-gauge-track" />
        {ratio > 0 && (
          <path d={arc(startAngle, angle, 40)} className={`wv-gauge-fill${over ? ' over' : ''}`} />
        )}
        <line x1={50} y1={50} x2={needle.x} y2={needle.y} className="wv-gauge-needle" />
        <circle cx={50} cy={50} r={3.5} className="wv-gauge-hub" />
        <text x={14} y={74} className="wv-gauge-tick">{min}</text>
        <text x={86} y={74} textAnchor="end" className="wv-gauge-tick">{max}</text>
      </svg>
      <div className={`wv-gauge-value${over ? ' over' : ''}`}>
        {raw === null ? '—' : raw.toFixed(decimals)}
        {widget.options.unit && <span className="wv-numeric-unit"> {widget.options.unit}</span>}
      </div>
    </div>
  );
}
