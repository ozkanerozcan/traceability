import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Plus } from 'lucide-react';
import { Alert, Badge, Button, Card, Input, Modal, useToast } from '../../../core/components/common';
import { traceService, type Trolley } from '../services/trace.service';

export default function TrolleysPage() {
  const { t } = useTranslation();
  const toast = useToast();
  const [trolleys, setTrolleys] = useState<Trolley[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [code, setCode] = useState('');
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

  const handleCreate = async () => {
    if (!code.trim()) return;
    setSaving(true);
    try {
      await traceService.createTrolley(code.trim());
      toast.success(t('common.success'));
      setFormOpen(false);
      setCode('');
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
        <Button onClick={() => setFormOpen(true)}>
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
            <Card key={tr.id} title={tr.code}>
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
        title={t('trace.addTrolley')}
        onClose={() => setFormOpen(false)}
        footer={
          <>
            <Button variant="ghost" onClick={() => setFormOpen(false)} disabled={saving}>{t('common.cancel')}</Button>
            <Button onClick={handleCreate} disabled={saving || !code.trim()}>{saving ? t('common.loading') : t('common.create')}</Button>
          </>
        }
      >
        <Input label={t('trace.trolleyCode')} value={code} onChange={(e) => setCode(e.target.value)} placeholder="TR-001" autoFocus />
      </Modal>
    </div>
  );
}
