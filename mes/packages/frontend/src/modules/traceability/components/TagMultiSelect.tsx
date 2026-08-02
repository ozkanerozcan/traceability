import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Search, X, ChevronDown, Check } from 'lucide-react';
import { Modal, Button } from '../../../core/components/common';
import type { PlcTag } from '../../plc-gateway/services/plc.service';

/**
 * Multi-select tag picker — PLC Data (plc_acquire) için hangi tag'lerin
 * ürüne yazılacağını seçmek üzere tasarlandı.
 *
 * Veri kaynağı (Select) pop-up'ına benzer arama destekli pop-up,
 * ancak çoklu seçim (checkbox) ve seçilenleri liste olarak gösterir.
 */

interface TagMultiSelectProps {
  label?: string;
  tags: PlcTag[];
  selectedIds: number[];
  onChange: (ids: number[]) => void;
  disabled?: boolean;
  placeholder?: string;
}

export default function TagMultiSelect({
  label,
  tags,
  selectedIds,
  onChange,
  disabled = false,
  placeholder,
}: TagMultiSelectProps) {
  const { t } = useTranslation();
  const [pickerOpen, setPickerOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');

  const selectedSet = new Set(selectedIds);
  const selectedTags = tags.filter((tg) => selectedSet.has(tg.id));

  const filteredTags = tags.filter((tg) => {
    if (!searchTerm.trim()) return true;
    const q = searchTerm.toLowerCase();
    return (
      tg.name.toLowerCase().includes(q) ||
      tg.address.toLowerCase().includes(q) ||
      (tg.description ?? '').toLowerCase().includes(q)
    );
  });

  const toggle = (tagId: number) => {
    if (disabled) return;
    if (selectedSet.has(tagId)) {
      onChange(selectedIds.filter((id) => id !== tagId));
    } else {
      onChange([...selectedIds, tagId]);
    }
  };

  const removeTag = (tagId: number) => {
    if (disabled) return;
    onChange(selectedIds.filter((id) => id !== tagId));
  };

  const summary =
    selectedIds.length === 0
      ? (placeholder ?? t('trace.noTagsSelected'))
      : t('trace.nTagsSelected', { count: selectedIds.length });

  return (
    <div className="form-group">
      {label && <span className="form-label">{label}</span>}

      {/* Seçilen tag'ler — düzenli liste görünümü */}
      {selectedTags.length > 0 && (
        <div
          style={{
            border: '1px solid var(--border-color)',
            borderRadius: 'var(--radius-md)',
            marginBottom: 'var(--space-2)',
            maxHeight: 180,
            overflowY: 'auto',
          }}
        >
          {selectedTags.map((tg, idx) => (
            <div
              key={tg.id}
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: 'var(--space-2) var(--space-3)',
                borderBottom:
                  idx < selectedTags.length - 1
                    ? '1px solid var(--border-color)'
                    : 'none',
                backgroundColor: 'var(--bg-secondary)',
              }}
            >
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 500, fontSize: 'var(--font-size-sm)' }}>
                  {tg.name}
                </div>
                <div
                  className="text-muted"
                  style={{
                    fontSize: 'var(--font-size-xs)',
                    fontFamily: 'var(--font-mono)',
                  }}
                >
                  {tg.address}
                  {tg.unit ? ` • ${tg.unit}` : ''}
                  {tg.dataType ? ` • ${tg.dataType}` : ''}
                </div>
              </div>
              {!disabled && (
                <button
                  type="button"
                  className="btn-icon"
                  onClick={() => removeTag(tg.id)}
                  title={t('common.delete')}
                  style={{ minWidth: 28, minHeight: 28, padding: 4 }}
                >
                  <X size={14} />
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Pop-up tetikleyici buton */}
      <button
        type="button"
        className="select-picker-trigger"
        onClick={() => !disabled && setPickerOpen(true)}
        disabled={disabled}
        aria-haspopup="dialog"
        aria-expanded={pickerOpen}
      >
        <span className="select-picker-label">{summary}</span>
        <ChevronDown size={18} className="select-picker-chevron" />
      </button>

      {/* Multi-select pop-up */}
      <Modal
        open={pickerOpen}
        title={label ?? t('trace.selectTags')}
        onClose={() => {
          setPickerOpen(false);
          setSearchTerm('');
        }}
        modalStack
        footer={
          <Button onClick={() => setPickerOpen(false)}>
            {t('common.confirm')} ({selectedIds.length})
          </Button>
        }
      >
        <div className="picker-popup-container">
          {/* Arama */}
          <div className="picker-search-wrapper">
            <Search size={16} className="picker-search-icon" />
            <input
              type="text"
              className="input picker-search-input"
              placeholder={t('trace.searchTags')}
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              autoFocus
            />
          </div>

          {/* Tag listesi */}
          <div className="picker-options-list">
            {filteredTags.length === 0 ? (
              <div
                className="text-muted"
                style={{ padding: 'var(--space-6)', textAlign: 'center' }}
              >
                {searchTerm.trim()
                  ? t('trace.noMatchingTags')
                  : t('trace.noTags')}
              </div>
            ) : (
              filteredTags.map((tg) => {
                const isSelected = selectedSet.has(tg.id);
                return (
                  <button
                    key={tg.id}
                    type="button"
                    className={`picker-option-item ${isSelected ? 'selected' : ''}`}
                    onClick={() => toggle(tg.id)}
                    disabled={disabled}
                  >
                    <span className="picker-option-label">
                      <span style={{ fontWeight: isSelected ? 600 : 400 }}>
                        {tg.name}
                      </span>
                      <span
                        className="text-muted"
                        style={{
                          display: 'block',
                          fontSize: 'var(--font-size-xs)',
                          fontFamily: 'var(--font-mono)',
                        }}
                      >
                        {tg.address}
                        {tg.unit ? ` • ${tg.unit}` : ''}
                        {tg.dataType ? ` • ${tg.dataType}` : ''}
                      </span>
                    </span>
                    {isSelected && (
                      <Check size={18} className="picker-option-check" />
                    )}
                  </button>
                );
              })
            )}
          </div>
        </div>
      </Modal>
    </div>
  );
}