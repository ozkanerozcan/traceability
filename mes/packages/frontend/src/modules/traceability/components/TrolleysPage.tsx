import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Plus, Pencil } from 'lucide-react';
import { Alert, Button, Card, Input, Modal, useToast } from '../../../core/components/common';
import { traceService, type Trolley } from '../services/trace.service';

export default function TrolleysPage() {
  const { t } = useTranslation();
  const toast = useToast();
  const [trolleys, setTrolleys] = useState<Trolley[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [code, setCode] = useState('');
  const [slotCount, setSlotCount] = useState<number>(20);
  const [editing, setEditing] = useState<Trolley | null>(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try {
      const { trolleys: tr } = await traceService.listTrolleys();
      setTrolleys(tr);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const openCreate = () => {
    setEditing(null);
    setCode('');
    setSlotCount(20);
    setFormOpen(true);
  };

  const openEdit = (tr: Trolley) => {
    setEditing(tr);
    setCode(tr.code);
    setSlotCount(tr.slotCount);
    setFormOpen(true);
  };

  const handleSave = async () => {
    if (!code.trim()) return;
    setSaving(true);
    try {
      if (editing) {
        // Kapasite (slot_count) güncelle — kalıcıdır, içerik sıfırlamada silinmez
        await traceService.updateTrolley(editing.id, slotCount);
      } else {
        await traceService.createTrolley(code.trim(), slotCount);
      }
      toast.success(t('common.success'));
      setFormOpen(false);
      setCode('');
      setEditing(null);
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('common.error'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-4" style={{ flexWrap: 'wrap', gap: 'var(--space-3)' }}>
        <h1 style={{ fontSize: 'var(--font-size-2xl)' }}>{t('trace.trolleys')}</h1>
        <Button onClick={openCreate}>
          <Plus size={16} /> {t('trace.addTrolley')}
        </Button>
      </div>

      {error && <Alert variant="danger" className="mb-4">{error}</Alert>}

      {loading ? (
        <p className="text-muted">{t('common.loading')}</p>
      ) : trolleys.length === 0 ? (
        <p className="text-muted">{t('trace.noTrolleys')}</p>
      ) : (
        <div className="trace-trolley-grid">
          {trolleys.map((tr) => (
            <Card
              key={tr.id}
              title={tr.code}
              actions={
                <button className="btn-icon" title={t('common.edit')} onClick={() => openEdit(tr)}>
                  <Pencil size={16} />
                </button>
              }
            >
              <div className="trace-slot-grid">
                {Array.from({ length: tr.slotCount }, (_, i) => {
                  const slot = tr.slots.find((s) => s.slot_number === i + 1);
                  return (
                    <div
                      key={i}
                      className={`trace-slot${slot ? ' filled' : ''}`}
                      title={slot ? slot.product_id : t('trace.emptySlot')}
                    >
                      {i + 1}
                    </div>
                  );
                })}
              </div>
              <div className="text-muted mt-4" style={{ fontSize: 'var(--font-size-xs)' }}>
                {t('trace.filledCount', { count: tr.slots.length, total: tr.slotCount })}
              </div>
            </Card>
          ))}
        </div>
      )}

      <Modal
        open={formOpen}
        title={editing ? t('trace.editTrolley') : t('trace.addTrolley')}
        onClose={() => setFormOpen(false)}
        footer={
          <>
            <Button variant="ghost" onClick={() => setFormOpen(false)} disabled={saving}>{t('common.cancel')}</Button>
            <Button onClick={handleSave} disabled={saving || !code.trim()}>{saving ? t('common.loading') : t('common.save')}</Button>
          </>
        }
      >
        <Input label={t('trace.trolleyCode')} value={code} onChange={(e) => setCode(e.target.value)} placeholder="TR-001" autoFocus disabled={!!editing} />
        <Input
          label={t('trace.slotCount')}
          type="number"
          min={1}
          max={100}
          value={slotCount}
          onChange={(e) => setSlotCount(Number(e.target.value))}
        />
        {editing && (
          <p className="text-muted" style={{ fontSize: 'var(--font-size-xs)' }}>
            {t('trace.slotCountHint')}
          </p>
        )}
      </Modal>
    </div>
  );
}
