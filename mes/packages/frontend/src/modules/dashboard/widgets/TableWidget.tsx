import { formatLiveValue, type LiveTagValue } from '../../plc-gateway/hooks/usePlcLiveData';
import type { PlcTag } from '../../plc-gateway/services/plc.service';
import type { WidgetConfig } from '../../recipe/services/recipe.service';

interface Props {
  widget: WidgetConfig;
  liveValues: Map<number, LiveTagValue>;
  tagMap: Map<number, PlcTag & { plcName?: string }>;
}

/** Çoklu değer tablosu — widget'a bağlı tag'lerin güncel değerleri. */
export default function TableWidget({ widget, liveValues, tagMap }: Props) {
  const tagIds = widget.tagIds ?? [];
  const showUnit = widget.options.showUnit !== false;

  if (tagIds.length === 0) {
    return <span className="text-muted" style={{ fontSize: 'var(--font-size-xs)' }}>—</span>;
  }

  return (
    <div className="wv-table-wrap">
      <table className="wv-table">
        <tbody>
          {tagIds.map((id) => {
            const tag = tagMap.get(id);
            const live = liveValues.get(id);
            const unit = showUnit ? tag?.unit : null;
            return (
              <tr key={id}>
                <td className="wv-table-name">{tag?.name ?? `#${id}`}</td>
                <td className={`wv-table-value${live?.quality === 'bad' ? ' wv-bad' : ''}`}>
                  {formatLiveValue(live?.value, unit)}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
