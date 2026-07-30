import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import type { LiveTagValue } from '../../plc-gateway/hooks/usePlcLiveData';
import type { WidgetConfig } from '../../recipe/services/recipe.service';

interface Props {
  widget: WidgetConfig;
  live?: LiveTagValue;
}

interface Point {
  t: number; // epoch ms
  v: number;
}

const MAX_POINTS = 600;

/** Canlı çizgi grafik — gelen WS değerlerini zaman penceresi içinde biriktirir. */
export default function TrendWidget({ widget, live }: Props) {
  const { t } = useTranslation();
  const [points, setPoints] = useState<Point[]>([]);
  const lastTs = useRef<string | null>(null);
  const decimals = widget.options.decimals ?? 2;
  const windowSeconds = widget.options.windowSeconds ?? 300;

  // Yeni canlı değer geldikçe seriye ekle
  useEffect(() => {
    if (!live || typeof live.value !== 'number') return;
    if (live.timestamp === lastTs.current) return;
    lastTs.current = live.timestamp;
    const t = new Date(live.timestamp).getTime();
    setPoints((prev) => [...prev.slice(-MAX_POINTS + 1), { t, v: live.value as number }]);
  }, [live]);

  // Zaman penceresi dışındaki eski noktaları periyodik olarak budamak için
  const now = Date.now();
  const windowed = useMemo(
    () => points.filter((p) => now - p.t <= windowSeconds * 1000),
    [points, now, windowSeconds]
  );

  const data = windowed.map((p) => ({
    t: new Date(p.t).toLocaleTimeString(),
    v: Number(p.v.toFixed(decimals)),
  }));

  return (
    <div className="wv-trend">
      {data.length < 2 ? (
        <span className="text-muted" style={{ fontSize: 'var(--font-size-xs)' }}>
          {t('dashboard.waitingData')}
        </span>
      ) : (
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 4, right: 8, bottom: 0, left: -14 }}>
            <XAxis dataKey="t" tick={{ fontSize: 10 }} minTickGap={40} stroke="var(--text-muted)" />
            <YAxis
              domain={[widget.options.yMin ?? 'auto', widget.options.yMax ?? 'auto']}
              tick={{ fontSize: 10 }}
              stroke="var(--text-muted)"
              width={44}
            />
            <Tooltip
              contentStyle={{
                background: 'var(--glass-strong)',
                border: '1px solid var(--border-color)',
                borderRadius: 'var(--radius-sm)',
                fontSize: 12,
              }}
            />
            {widget.options.warningHigh !== undefined && (
              <ReferenceLine y={widget.options.warningHigh} stroke="var(--color-warning)" strokeDasharray="4 3" />
            )}
            <Line
              type="monotone"
              dataKey="v"
              stroke="var(--accent)"
              strokeWidth={2}
              dot={false}
              isAnimationActive={false}
            />
          </LineChart>
        </ResponsiveContainer>
      )}
    </div>
  );
}
