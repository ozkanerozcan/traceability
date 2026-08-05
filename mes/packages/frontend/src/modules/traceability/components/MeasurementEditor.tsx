import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pencil, Plus, Trash2 } from 'lucide-react';
import { Alert, Badge, Button, ConfirmDialog, useToast } from '../../../core/components/common';
import { traceService, type Measurement } from '../services/trace.service';

/**
 * MeasurementEditor — bir shell'in belirli bir istasyondaki ölçümlerini
 * listeler ve web'den EKLEME / DÜZENLEME / SİLME sağlar.
 *
 * Kullanıcı talebi: PLC'den gelen veri düzenlenebilir/silinebilir; hiç veri
 * gelmemişse web arayüzünden "PLC'den gelmiş gibi" (source='manual') girilebilir.
 */

interface Props {
  shellId: string;
  stationKey: string;
  /** Yeni ölçüm eklerken önerilen alan adları (istasyonun dataTag'leri) */
  suggestedFields?: string[];
  /** Değişiklik sonrası çağrılır (liste tazelemek için) */
  onChanged?: () => void;
}

export default function MeasurementEditor({ shellId, stationKey, suggestedFields = [], onChanged }: Props) {
  const { t } = useTranslation();
  const toast = useToast();
  const [items, setItems] = useState<Measurement[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Yeni ölçüm formu
  const [newField, setNewField] = useState('');
  const [newValue, setNewValue] = useState('');
  const [adding, setAdding] = useState(false);

  // Düzenleme
  const [editId, setEditId] = useState<number | null>(null);
  const [editValue, setEditValue] = useState('');

  // Silme
  const [deleteTarget, setDeleteTarget] = useState<Measurement | null>(null);
  const [deleting, setDeleting] = useState(false);

  const load = useCallback(async () => {
    try {
      const { measurements } = await traceService.listMeasurements(shellId, stationKey);
      setItems(measurements);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [shellId, stationKey]);

  useEffect(() => {
    void load();
  }, [load]);

  const handleAdd = async (fieldOverride?: string, valueOverride?: string) => {
    const field = (fieldOverride ?? newField).trim();
    const value = (valueOverride ?? newValue).trim();
    if (!field || !value) return;
    setAdding(true);
    try {
      const num = Number(value);
      const { measurements } = await traceService.createMeasurement({
        shellId,
        stationKey,
        field,
        value: Number.isFinite(num) && value !== '' ? num : value,
      });
      setItems(measurements);
      setNewField('');
      setNewValue('');
      toast.success(t('trace.measurementSaved'));
      onChanged?.();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('common.error'));
    } finally {
      setAdding(false);
    }
  };

  const handleUpdate = async (m: Measurement) => {
    if (!editValue.trim()) return;
    try {
      const num = Number(editValue);
      await traceService.updateMeasurement(m.id, Number.isFinite(num) && editValue.trim() !== '' ? num : editValue.trim());
      setEditId(null);
      toast.success(t('trace.measurementSaved'));
      await load();
      onChanged?.();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('common.error'));
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await traceService.deleteMeasurement(deleteTarget.id);
      toast.success(t('trace.measurementDeleted'));
      setDeleteTarget(null);
      await load();
      onChanged?.();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('common.error'));
    } finally {
      setDeleting(false);
    }
  };

  // Önerilen alanlardan henüz ölçümü olmayanlar (hızlı ekleme satırları)
  const missingSuggestions = suggestedFields.filter((f) => !items.some((m) => m.field === f));

  return (
    <div className="trace-measurement-editor">
      {error && <Alert variant="danger" className="mb-2">{error}</Alert>}

      {loading ? (
        <p className="text-muted" style={{ fontSize: 'var(--font-size-xs)' }}>{t('common.loading')}</p>
      ) : items.length === 0 ? (
        <p className="text-muted" style={{ fontSize: 'var(--font-size-xs)' }}>{t('trace.noMeasurements')}</p>
      ) : (
        <div className="trace-measurement-list">
          {items.map((m) => (
            <div key={m.id} className="trace-measurement-row">
              <div className="trace-measurement-field">
                {m.field}
                <span className="trace-measurement-source">
                  <Badge variant={m.source === 'plc' ? 'info' : 'muted'}>
                    {m.source === 'plc' ? t('trace.sourcePlc') : t('trace.sourceManual')}
                  </Badge>
                </span>
              </div>
              {editId === m.id ? (
                <div className="flex gap-1" style={{ alignItems: 'center' }}>
                  <input
                    className="input"
                    style={{ width: 110, padding: '4px 8px', fontSize: 'var(--font-size-sm)' }}
                    value={editValue}
                    autoFocus
                    onChange={(e) => setEditValue(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') void handleUpdate(m);
                      if (e.key === 'Escape') setEditId(null);
                    }}
                  />
                  <Button small onClick={() => void handleUpdate(m)}>{t('common.save')}</Button>
                  <Button small variant="ghost" onClick={() => setEditId(null)}>{t('common.cancel')}</Button>
                </div>
              ) : (
                <>
                  <div className="trace-measurement-value">{m.value ?? '—'}</div>
                  <div className="flex gap-1">
                    <button
                      className="btn-icon"
                      title={t('trace.editValue')}
                      onClick={() => { setEditId(m.id); setEditValue(String(m.value ?? '')); }}
                    >
                      <Pencil size={14} />
                    </button>
                    <button className="btn-icon text-danger" title={t('common.delete')} onClick={() => setDeleteTarget(m)}>
                      <Trash2 size={14} />
                    </button>
                  </div>
                </>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Önerilen alanlar için hızlı ekleme (istasyonun tanımlı ama henüz veri gelmemiş alanları) */}
      {missingSuggestions.map((f) => (
        <SuggestedFieldRow key={f} field={f} disabled={adding} onAdd={(val) => void handleAdd(f, val)} />
      ))}

      {/* Serbest alan ekleme */}
      <div className="trace-measurement-add">
        <input
          className="input"
          placeholder={t('trace.newFieldPlaceholder')}
          value={newField}
          onChange={(e) => setNewField(e.target.value)}
          list={`fields-${stationKey}`}
        />
        <datalist id={`fields-${stationKey}`}>
          {suggestedFields.map((f) => (
            <option key={f} value={f} />
          ))}
        </datalist>
        <input
          className="input"
          style={{ maxWidth: 120 }}
          placeholder={t('trace.value')}
          value={newValue}
          onChange={(e) => setNewValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void handleAdd();
          }}
        />
        <Button small onClick={() => void handleAdd()} disabled={adding || !newField.trim() || !newValue.trim()}>
          <Plus size={14} /> {t('trace.addMeasurement')}
        </Button>
      </div>

      <ConfirmDialog
        open={deleteTarget !== null}
        title={t('common.delete')}
        message={t('trace.deleteMeasurementConfirm', { field: deleteTarget?.field })}
        confirmLabel={t('common.delete')}
        danger
        busy={deleting}
        onConfirm={() => void handleDelete()}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  );
}

/** Önerilen alan için tek satırlık hızlı giriş (değer yaz + Enter/Ekle) */
function SuggestedFieldRow({ field, disabled, onAdd }: { field: string; disabled: boolean; onAdd: (value: string) => void }) {
  const { t } = useTranslation();
  const [value, setValue] = useState('');
  return (
    <div className="trace-measurement-row trace-measurement-suggested">
      <div className="trace-measurement-field">
        {field}
        <span className="trace-measurement-source">
          <Badge variant="warning">{t('trace.sourceManual')}</Badge>
        </span>
      </div>
      <input
        className="input"
        style={{ width: 110, padding: '4px 8px', fontSize: 'var(--font-size-sm)' }}
        placeholder={t('trace.value')}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && value.trim()) {
            onAdd(value.trim());
            setValue('');
          }
        }}
      />
      <Button
        small
        variant="ghost"
        disabled={disabled || !value.trim()}
        onClick={() => {
          onAdd(value.trim());
          setValue('');
        }}
      >
        <Plus size={14} />
      </Button>
    </div>
  );
}
