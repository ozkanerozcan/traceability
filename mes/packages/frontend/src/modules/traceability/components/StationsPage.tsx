import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Plus, Pencil, Trash2, Play } from 'lucide-react';
import { Alert, Badge, Button, Checkbox, ConfirmDialog, Input, Modal, Select, Table, useToast } from '../../../core/components/common';
import { traceService, CAPABILITY_KEYS, type Station, type StationCapability } from '../services/trace.service';
import { plcService, tagService, type PlcProfile, type PlcTag } from '../../plc-gateway/services/plc.service';

export default function StationsPage() {
  const { t } = useTranslation();
  const toast = useToast();
  const [stations, setStations] = useState<Station[]>([]);
  const [plcs, setPlcs] = useState<PlcProfile[]>([]);
  const [tags, setTags] = useState<PlcTag[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Station | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Station | null>(null);
  const [busyId, setBusyId] = useState<number | null>(null);

  const load = useCallback(async () => {
    try {
      const [{ stations: s }, { plcs: p }] = await Promise.all([
        traceService.listStations(),
        plcService.list(),
      ]);
      setStations(s);
      setPlcs(p);
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

  const loadTags = useCallback(async (plcId: number) => {
    try {
      const { tags: tg } = await tagService.list(plcId);
      setTags(tg);
    } catch {
      setTags([]);
    }
  }, []);

  const handleDelete = async () => {
    if (!deleteTarget) return;
    setBusyId(deleteTarget.id);
    try {
      await traceService.deleteStation(deleteTarget.id);
      setDeleteTarget(null);
      toast.success(t('common.success'));
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('common.error'));
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-4" style={{ flexWrap: 'wrap', gap: 'var(--space-3)' }}>
        <h1 style={{ fontSize: 'var(--font-size-2xl)' }}>{t('trace.stations')}</h1>
        <Button onClick={() => { setEditing(null); setFormOpen(true); }}>
          <Plus size={16} /> {t('trace.addStation')}
        </Button>
      </div>

      {error && <Alert variant="danger" className="mb-4">{error}</Alert>}

      {loading ? (
        <p className="text-muted">{t('common.loading')}</p>
      ) : (
        <Table>
          <thead>
            <tr>
              <th>{t('common.name')}</th>
              <th>{t('trace.capabilities')}</th>
              <th>{t('common.status')}</th>
              <th style={{ width: 160 }}>{t('common.actions')}</th>
            </tr>
          </thead>
          <tbody>
            {stations.map((s) => (
              <tr key={s.id}>
                <td>
                  <div style={{ fontWeight: 600 }}>{s.name}</div>
                  <div className="text-muted" style={{ fontSize: 'var(--font-size-xs)', fontFamily: 'var(--font-mono)' }}>{s.key}</div>
                </td>
                <td>
                  <div className="flex gap-1" style={{ flexWrap: 'wrap' }}>
                    {s.capabilities.map((c) => (
                      <Badge key={c} variant="info">{t(`trace.cap.${c}`)}</Badge>
                    ))}
                  </div>
                </td>
                <td>
                  {s.isActive ? (
                    <Badge variant="success">{t('common.active')}</Badge>
                  ) : (
                    <Badge variant="muted">{t('common.inactive')}</Badge>
                  )}
                </td>
                <td>
                  <div className="flex gap-1">
                    <Link to={`/trace/work/${s.key}`} className="btn-icon" title={t('trace.work')}>
                      <Play size={16} />
                    </Link>
                    <button className="btn-icon" title={t('common.edit')} onClick={() => { setEditing(s); setFormOpen(true); }}>
                      <Pencil size={16} />
                    </button>
                    <button className="btn-icon" title={t('common.delete')} disabled={busyId === s.id} onClick={() => setDeleteTarget(s)}>
                      <Trash2 size={16} />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}

      <StationForm
        open={formOpen}
        onClose={() => setFormOpen(false)}
        onSaved={load}
        station={editing}
        plcs={plcs}
        tags={tags}
        onPlcChange={loadTags}
      />

      <ConfirmDialog
        open={deleteTarget !== null}
        title={t('trace.deleteStation')}
        message={t('trace.deleteStationConfirm', { name: deleteTarget?.name })}
        busy={busyId !== null}
        onConfirm={handleDelete}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  );
}

// ─── İstasyon Formu ─────────────────────────────────────────────────────────

interface StationFormProps {
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
  station: Station | null;
  plcs: PlcProfile[];
  tags: PlcTag[];
  onPlcChange: (plcId: number) => void;
}

function StationForm({ open, onClose, onSaved, station, plcs, tags, onPlcChange }: StationFormProps) {
  const { t } = useTranslation();
  const toast = useToast();
  const isEdit = !!station;

  const [key, setKey] = useState('');
  const [name, setName] = useState('');
  const [type, setType] = useState('generic');
  const [caps, setCaps] = useState<StationCapability[]>([]);
  const [plcId, setPlcId] = useState<number | ''>('');
  const [plcTagId, setPlcTagId] = useState<number | ''>('');
  const [waitHours, setWaitHours] = useState<number>(24);
  const [groupSize, setGroupSize] = useState<number>(4);
  const [isActive, setIsActive] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) {
      setKey(station?.key ?? '');
      setName(station?.name ?? '');
      setType(station?.type ?? 'generic');
      setCaps(station?.capabilities ?? []);
      setPlcId(station?.config.plcId ?? '');
      setPlcTagId(station?.config.plcTagId ?? '');
      setWaitHours(station?.config.waitHours ?? 24);
      setGroupSize(station?.config.groupSize ?? 4);
      setIsActive(station?.isActive ?? true);
      setError(null);
      if (station?.config.plcId) onPlcChange(station.config.plcId);
    }
  }, [open, station, onPlcChange]);

  const toggleCap = (c: StationCapability) => {
    setCaps((prev) => (prev.includes(c) ? prev.filter((x) => x !== c) : [...prev, c]));
  };

  const handleSubmit = async () => {
    if (!name.trim() || (!isEdit && !key.trim())) {
      setError(t('trace.fillRequired'));
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const config = {
        ...(plcId ? { plcId: Number(plcId) } : {}),
        ...(plcTagId ? { plcTagId: Number(plcTagId) } : {}),
        ...(caps.includes('wait_control') ? { waitHours } : {}),
        ...(caps.includes('plc_acquire') ? { groupSize } : {}),
      };
      if (isEdit) {
        await traceService.updateStation(station.id, {
          name: name.trim(),
          type,
          is_active: isActive,
          capabilities: caps,
          config,
        });
      } else {
        await traceService.createStation({ key: key.trim(), name: name.trim(), type, capabilities: caps, config });
      }
      toast.success(t('common.success'));
      onSaved();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : t('common.error'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open={open}
      title={isEdit ? t('trace.editStation') : t('trace.addStation')}
      onClose={onClose}
      wide
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={saving}>{t('common.cancel')}</Button>
          <Button onClick={handleSubmit} disabled={saving}>{saving ? t('common.loading') : t('common.save')}</Button>
        </>
      }
    >
      {error && <Alert variant="danger" className="mb-4">{error}</Alert>}

      <div className="flex gap-3">
        <div style={{ flex: 1 }}>
          <Input label={t('trace.stationKey')} value={key} onChange={(e) => setKey(e.target.value)} disabled={isEdit} placeholder="filling" required={!isEdit} />
        </div>
        <div style={{ flex: 2 }}>
          <Input label={t('common.name')} value={name} onChange={(e) => setName(e.target.value)} required />
        </div>
        <div style={{ flex: 1 }}>
          <Select label={t('trace.stationType')} value={type} onChange={(e) => setType(e.target.value)}>
            <option value="generic">{t('trace.type.generic')}</option>
            <option value="qr">{t('trace.type.qr')}</option>
            <option value="trolley">{t('trace.type.trolley')}</option>
            <option value="plc">{t('trace.type.plc')}</option>
            <option value="wait">{t('trace.type.wait')}</option>
            <option value="check">{t('trace.type.check')}</option>
            <option value="assembly">{t('trace.type.assembly')}</option>
          </Select>
        </div>
      </div>

      <div className="form-group">
        <span className="form-label">{t('trace.capabilities')}</span>
        <div className="flex gap-3" style={{ flexWrap: 'wrap' }}>
          {CAPABILITY_KEYS.map((c) => (
            <Checkbox key={c} label={t(`trace.cap.${c}`)} checked={caps.includes(c)} onChange={() => toggleCap(c)} />
          ))}
        </div>
      </div>

      {(caps.includes('plc_acquire') || caps.includes('trolley_assign')) && (
        <div className="flex gap-3">
          <div style={{ flex: 1 }}>
            <Select
              label={t('trace.plc')}
              value={plcId}
              onChange={(e) => {
                const v = e.target.value ? Number(e.target.value) : '';
                setPlcId(v);
                setPlcTagId('');
                if (v) onPlcChange(Number(v));
              }}
            >
              <option value="">{t('trace.noPlc')}</option>
              {plcs.map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </Select>
          </div>
          <div style={{ flex: 1 }}>
            <Select label={t('trace.plcTag')} value={plcTagId} onChange={(e) => setPlcTagId(e.target.value ? Number(e.target.value) : '')} disabled={!plcId}>
              <option value="">{t('trace.noTag')}</option>
              {tags.map((tg) => (
                <option key={tg.id} value={tg.id}>{tg.name}</option>
              ))}
            </Select>
          </div>
          {caps.includes('plc_acquire') && (
            <div style={{ flex: 1 }}>
              <Input label={t('trace.groupSize')} type="number" min={1} value={groupSize} onChange={(e) => setGroupSize(Number(e.target.value))} />
            </div>
          )}
        </div>
      )}

      {caps.includes('wait_control') && (
        <Input label={t('trace.waitHours')} type="number" min={1} value={waitHours} onChange={(e) => setWaitHours(Number(e.target.value))} />
      )}

      <Checkbox label={t('common.active')} checked={isActive} onChange={(e) => setIsActive(e.target.checked)} />
    </Modal>
  );
}
