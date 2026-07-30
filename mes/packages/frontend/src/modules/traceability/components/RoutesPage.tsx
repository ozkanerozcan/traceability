import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Plus, ArrowUp, ArrowDown, Save } from 'lucide-react';
import { Alert, Badge, Button, Card, Input, Modal, useToast } from '../../../core/components/common';
import { traceService, type Route, type Station } from '../services/trace.service';

export default function RoutesPage() {
  const { t } = useTranslation();
  const toast = useToast();
  const [routes, setRoutes] = useState<Route[]>([]);
  const [stations, setStations] = useState<Station[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [name, setName] = useState('');
  const [saving, setSaving] = useState(false);
  const [editingSteps, setEditingSteps] = useState<Record<number, number[]>>({});

  const load = useCallback(async () => {
    try {
      const [{ routes: r }, { stations: s }] = await Promise.all([
        traceService.listRoutes(),
        traceService.listStations(),
      ]);
      setRoutes(r);
      setStations(s);
      const steps: Record<number, number[]> = {};
      for (const route of r) steps[route.id] = [...route.steps];
      setEditingSteps(steps);
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

  const stationName = (id: number) => stations.find((s) => s.id === id)?.name ?? `#${id}`;

  const move = (routeId: number, index: number, dir: -1 | 1) => {
    setEditingSteps((prev) => {
      const arr = [...(prev[routeId] ?? [])];
      const j = index + dir;
      if (j < 0 || j >= arr.length) return prev;
      [arr[index], arr[j]] = [arr[j], arr[index]];
      return { ...prev, [routeId]: arr };
    });
  };

  const toggleStation = (routeId: number, stationId: number) => {
    setEditingSteps((prev) => {
      const arr = prev[routeId] ?? [];
      return {
        ...prev,
        [routeId]: arr.includes(stationId) ? arr.filter((x) => x !== stationId) : [...arr, stationId],
      };
    });
  };

  const saveSteps = async (routeId: number) => {
    setSaving(true);
    try {
      await traceService.setRouteSteps(routeId, editingSteps[routeId] ?? []);
      toast.success(t('common.success'));
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('common.error'));
    } finally {
      setSaving(false);
    }
  };

  const handleCreate = async () => {
    if (!name.trim()) return;
    setSaving(true);
    try {
      await traceService.createRoute(name.trim());
      toast.success(t('common.success'));
      setFormOpen(false);
      setName('');
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
        <h1 style={{ fontSize: 'var(--font-size-2xl)' }}>{t('trace.routes')}</h1>
        <Button onClick={() => setFormOpen(true)}>
          <Plus size={16} /> {t('trace.addRoute')}
        </Button>
      </div>

      {error && <Alert variant="danger" className="mb-4">{error}</Alert>}

      {loading ? (
        <p className="text-muted">{t('common.loading')}</p>
      ) : (
        routes.map((route) => (
          <Card key={route.id} title={route.name}>
            <div className="trace-route-editor">
              {/* Mevcut sıra */}
              <div>
                <div className="form-label mb-4">{t('trace.routeSteps')}</div>
                {(editingSteps[route.id] ?? []).length === 0 ? (
                  <p className="text-muted">{t('trace.noSteps')}</p>
                ) : (
                  (editingSteps[route.id] ?? []).map((sid, i) => (
                    <div key={sid} className="trace-route-step">
                      <Badge variant="muted">{i + 1}</Badge>
                      <span style={{ flex: 1 }}>{stationName(sid)}</span>
                      <button className="btn-icon" onClick={() => move(route.id, i, -1)} disabled={i === 0}>
                        <ArrowUp size={14} />
                      </button>
                      <button className="btn-icon" onClick={() => move(route.id, i, 1)} disabled={i === (editingSteps[route.id] ?? []).length - 1}>
                        <ArrowDown size={14} />
                      </button>
                    </div>
                  ))
                )}
              </div>

              {/* İstasyon seçimi */}
              <div>
                <div className="form-label mb-4">{t('trace.availableStations')}</div>
                <div className="flex gap-1" style={{ flexWrap: 'wrap' }}>
                  {stations.map((s) => {
                    const included = (editingSteps[route.id] ?? []).includes(s.id);
                    return (
                      <Button
                        key={s.id}
                        variant={included ? 'primary' : 'secondary'}
                        small
                        onClick={() => toggleStation(route.id, s.id)}
                      >
                        {s.name}
                      </Button>
                    );
                  })}
                </div>
              </div>
            </div>

            <Button onClick={() => saveSteps(route.id)} disabled={saving} className="mt-4">
              <Save size={16} /> {saving ? t('common.loading') : t('common.save')}
            </Button>
          </Card>
        ))
      )}

      <Modal
        open={formOpen}
        title={t('trace.addRoute')}
        onClose={() => setFormOpen(false)}
        footer={
          <>
            <Button variant="ghost" onClick={() => setFormOpen(false)} disabled={saving}>{t('common.cancel')}</Button>
            <Button onClick={handleCreate} disabled={saving || !name.trim()}>{saving ? t('common.loading') : t('common.create')}</Button>
          </>
        }
      >
        <Input label={t('common.name')} value={name} onChange={(e) => setName(e.target.value)} autoFocus />
      </Modal>
    </div>
  );
}
