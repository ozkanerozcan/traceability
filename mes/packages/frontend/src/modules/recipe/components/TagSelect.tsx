import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronDown, Search, X } from 'lucide-react';
import { Modal } from '../../../core/components/common';
import type { PlcTag } from '../../plc-gateway/services/plc.service';

export interface PlcTagGroup {
  plcId: number;
  plcName: string;
  tags: PlcTag[];
}

interface TagSelectProps {
  tagGroups: PlcTagGroup[];
  value: number | null;
  onChange: (tagId: number | null) => void;
}

/**
 * PLC tag seçici — NodeBrowserDialog ile aynı desen:
 * trigger butonuna basınca mevcut pop-up'ın ÜZERİNDE yeni bir seçim
 * diyaloğu açılır (ana pop-up arka planda açık kalır).
 * Diyalogda arama kutusu + PLC'ye göre gruplu tag listesi gösterilir.
 */
export default function TagSelect({ tagGroups, value, onChange }: TagSelectProps) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');

  // Diyalog her açıldığında aramayı sıfırla
  useEffect(() => {
    if (open) setQuery('');
  }, [open]);

  const selectedTag = useMemo(() => {
    if (value == null) return null;
    for (const group of tagGroups) {
      const tag = group.tags.find((x) => x.id === value);
      if (tag) return { ...tag, plcName: group.plcName };
    }
    return null;
  }, [tagGroups, value]);

  const filteredGroups = useMemo(() => {
    const term = query.trim().toLowerCase();
    if (!term) return tagGroups;
    return tagGroups
      .map((group) => ({
        ...group,
        tags: group.tags.filter(
          (tag) =>
            tag.name.toLowerCase().includes(term) ||
            group.plcName.toLowerCase().includes(term) ||
            tag.address.toLowerCase().includes(term) ||
            tag.dataType.toLowerCase().includes(term)
        ),
      }))
      .filter((group) => group.tags.length > 0);
  }, [tagGroups, query]);

  const select = (tagId: number | null) => {
    onChange(tagId);
    setOpen(false);
  };

  return (
    <>
      <button
        type="button"
        className="tag-select-trigger"
        onClick={() => setOpen(true)}
      >
        {selectedTag ? (
          <span className="tag-select-value">
            {selectedTag.name}
            <span className="text-muted"> · {selectedTag.plcName} · {selectedTag.dataType}</span>
          </span>
        ) : (
          <span className="text-muted">{t('recipe.config.noBinding')}</span>
        )}
        <ChevronDown size={16} />
      </button>

      {/* Seçim diyaloğu — ana modalın üzerinde açılır (modalStack) */}
      <Modal
        open={open}
        modalStack
        title={t('recipe.config.dataSource')}
        onClose={() => setOpen(false)}
      >
        <div className="tag-picker-search">
          <Search size={14} />
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t('recipe.config.searchTags')}
          />
          {query && (
            <button type="button" className="btn-icon" onClick={() => setQuery('')}>
              <X size={14} />
            </button>
          )}
        </div>

        <div className="tag-picker-list">
          <div
            className={`tag-select-item${value == null ? ' selected' : ''}`}
            onClick={() => select(null)}
          >
            {t('recipe.config.noBinding')}
          </div>

          {filteredGroups.length === 0 ? (
            <div className="tag-select-empty text-muted">{t('common.noData')}</div>
          ) : (
            filteredGroups.map((group) => (
              <div key={group.plcId}>
                <div className="tag-select-group-label">{group.plcName}</div>
                {group.tags.map((tag) => (
                  <div
                    key={tag.id}
                    className={`tag-select-item${tag.id === value ? ' selected' : ''}`}
                    onClick={() => select(tag.id)}
                  >
                    {tag.name}
                    <span className="text-muted"> · {tag.address} · {tag.dataType}</span>
                  </div>
                ))}
              </div>
            ))
          )}
        </div>
      </Modal>
    </>
  );
}
