import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Plus, Pencil, Trash2, Play, Wrench } from 'lucide-react';
import { Alert, Badge, Button, Checkbox, ConfirmDialog, EmptyState, Input, Modal, Select, Table, useToast } from '../../../core/components/common';
import { traceService, STATION_TYPES, PLC_STATION_TYPES, type Station, type StationConfig, type StationType } from '../services/trace.service';
import { plcService, tagService, type PlcProfile, type PlcTag } from '../../plc-gateway/services/plc.service';
import TagMultiSelect from './TagMultiSelect';

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
      ) : stations.length === 0 ? (
        <EmptyState
          icon={<Wrench size={32} />}
          title={t('common.emptyTitle')}
          description={t('common.emptyDescription')}
          action={
            <Button onClick={() => { setEditing(null); setFormOpen(true); }}>
              <Plus size={16} /> {t('trace.addStation')}
            </Button>
          }
        />
      ) : (
        <Table>
          <thead>
            <tr>
              <th>{t('common.name')}</th>
              <th>{t('trace.stationType')}</th>
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
                  <Badge variant={s.type === 'legacy' ? 'muted' : 'info'}>{t(`trace.type.${s.type}`, { defaultValue: s.type })}</Badge>
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

// ─── Yardımcılar ─────────────────────────────────────────────────────────────

/** İsimden URL-güvenli anahtar üretir (çalışma sayfası rotası için). */
function slugify(s: string): string {
  const map: Record<string, string> = {
    'ç': 'c', 'ğ': 'g', 'ı': 'i', 'ö': 'o', 'ş': 's', 'ü': 'u',
    'Ç': 'c', 'Ğ': 'g', 'İ': 'i', 'I': 'i', 'Ö': 'o', 'Ş': 's', 'Ü': 'u',
  };
  return s
    .split('')
    .map((ch) => map[ch] ?? ch)
    .join('')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

// ─── İstasyon Formu (tip bazlı — her tip kendi ayarlarına sahip) ────────────

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

  const [name, setName] = useState('');
  const [type, setType] = useState<StationType | 'legacy'>('qr_generate');
  const [config, setConfig] = useState<StationConfig>({});
  const [isActive, setIsActive] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) {
      setName(station?.name ?? '');
      setType((station?.type as StationType) ?? 'qr_generate');
      setConfig(station?.config ?? {});
      setIsActive(station?.isActive ?? true);
      setError(null);
      if (station?.config.plcId) onPlcChange(station.config.plcId);
    }
  }, [open, station, onPlcChange]);

  // Anahtar: düzenlemede mevcut, yeni kayıtta isimden otomatik üretilir
  const key = isEdit ? station.key : slugify(name);
  const isPlcStation = PLC_STATION_TYPES.includes(type as StationType);

  const set = <K extends keyof StationConfig>(k: K, value: StationConfig[K] | undefined) => {
    setConfig((prev) => ({ ...prev, [k]: value }));
  };

  const handlePlcSelect = (plcId: number | undefined) => {
    setConfig((prev) => ({
      ...prev,
      plcId,
      triggerTagId: undefined,
      shellIdTagId: undefined,
      trolleyIdTagId: undefined,
      slotTagId: undefined,
      rowTagId: undefined,
      dataTagIds: [],
      ackTagId: undefined,
      errorCodeTagId: undefined,
      errorMessageTagId: undefined,
      busyTagId: undefined,
    }));
    if (plcId) onPlcChange(plcId);
  };

  const handleSubmit = async () => {
    if (!name.trim() || !key) {
      setError(t('trace.fillRequired'));
      return;
    }
    setSaving(true);
    setError(null);
    try {
      if (isEdit) {
        await traceService.updateStation(station.id, {
          name: name.trim(),
          type,
          is_active: isActive,
          config,
        });
      } else {
        await traceService.createStation({ key, name: name.trim(), type, config });
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

  // Tag seçici yardımcısı
  const TagSelectField = ({ label, cfgKey, filter }: { label: string; cfgKey: keyof StationConfig; filter?: (tg: PlcTag) => boolean }) => (
    <Select
      label={label}
      value={(config[cfgKey] as number | undefined) ?? ''}
      onChange={(e) => set(cfgKey, e.target.value ? Number(e.target.value) : undefined)}
      disabled={!config.plcId}
    >
      <option value="">{t('trace.noTag')}</option>
      {tags.filter((tg) => (filter ? filter(tg) : true)).map((tg) => (
        <option key={tg.id} value={tg.id}>{tg.name}</option>
      ))}
    </Select>
  );

  return (
    <Modal
      open={open}
      title={isEdit ? t('trace.editStation') : t('trace.addStation')}
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={saving}>{t('common.cancel')}</Button>
          <Button onClick={handleSubmit} disabled={saving}>{saving ? t('common.loading') : t('common.save')}</Button>
        </>
      }
    >
      {error && <Alert variant="danger" className="mb-4">{error}</Alert>}

      <Input label={t('common.name')} value={name} onChange={(e) => setName(e.target.value)} required autoFocus placeholder={t('trace.stationNamePlaceholder')} />

      {/* Anahtar — otomatik */}
      <div className="text-muted" style={{ fontSize: 'var(--font-size-xs)', marginTop: 'calc(-1 * var(--space-2))', marginBottom: 'var(--space-4)' }}>
        {t('trace.stationKey')}: <span style={{ fontFamily: 'var(--font-mono)' }}>{key || '—'}</span>
        {'  '}
        <span>({t('trace.autoDerived')})</span>
      </div>

      {/* İstasyon Tipi */}
      <Select label={t('trace.stationType')} value={type} onChange={(e) => setType(e.target.value as StationType)}>
        {STATION_TYPES.map((st) => (
          <option key={st} value={st}>{t(`trace.type.${st}`)}</option>
        ))}
        {type === 'legacy' && <option value="legacy">{t('trace.type.legacy')}</option>}
      </Select>
      <p className="text-muted" style={{ fontSize: 'var(--font-size-xs)', marginTop: 'calc(-1 * var(--space-2))', marginBottom: 'var(--space-4)' }}>
        {t(`trace.typeDesc.${type}`, { defaultValue: '' })}
      </p>

      {/* ─── QR Kod Üretim ayarları ─── */}
      {type === 'qr_generate' && (
        <div className="flex gap-3">
          <div style={{ flex: 1 }}>
            <Input label={t('trace.labelWidth')} type="number" min={10} max={300} value={config.labelWidth ?? 50} onChange={(e) => set('labelWidth', Number(e.target.value))} />
          </div>
          <div style={{ flex: 1 }}>
            <Input label={t('trace.labelHeight')} type="number" min={10} max={300} value={config.labelHeight ?? 30} onChange={(e) => set('labelHeight', Number(e.target.value))} />
          </div>
        </div>
      )}

      {/* ─── PLC Sözleşmesi (PLC'li istasyonlar) ─── */}
      {isPlcStation && (
        <>
          <div style={{ fontWeight: 600, fontSize: 'var(--font-size-sm)', marginBottom: 'var(--space-2)' }}>
            ⚡ {t('trace.plcContract')}
          </div>

          <Select label={t('trace.plc')} value={config.plcId ?? ''} onChange={(e) => handlePlcSelect(e.target.value ? Number(e.target.value) : undefined)}>
            <option value="">{t('trace.selectPlc')}</option>
            {plcs.map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
            {plcs.length === 0 && <option value="" disabled>{t('trace.noPlcAvailable')}</option>}
          </Select>

          {/* Trigger — yalnız subscribe + BOOL */}
          <Select
            label={t('trace.triggerTag')}
            value={config.triggerTagId ?? ''}
            onChange={(e) => set('triggerTagId', e.target.value ? Number(e.target.value) : undefined)}
            disabled={!config.plcId}
          >
            <option value="">{t('trace.noTag')}</option>
            {tags.filter((tg) => tg.acquisitionMode === 'subscribe' && tg.dataType === 'BOOL').map((tg) => (
              <option key={tg.id} value={tg.id}>{tg.name}</option>
            ))}
            {config.plcId && tags.filter((tg) => tg.acquisitionMode === 'subscribe' && tg.dataType === 'BOOL').length === 0 && (
              <option value="" disabled>{t('trace.noBoolTag')}</option>
            )}
          </Select>
          <p className="text-muted" style={{ fontSize: 'var(--font-size-xs)', marginTop: 'calc(-1 * var(--space-2))', marginBottom: 'var(--space-3)' }}>
            {t('trace.triggerSubscribeHint')}
          </p>

          {/* Tip bazında sözleşme alanları */}
          {type === 'trolley_read' && (
            <TagSelectField label={t('trace.trolleyIdTag')} cfgKey="trolleyIdTagId" />
          )}

          {type === 'funnel_screwing' && (
            <TagSelectField label={t('trace.shellIdTag')} cfgKey="shellIdTagId" />
          )}

          {type === 'trolley_shell_matching' && (
            <>
              <TagSelectField label={t('trace.shellIdTag')} cfgKey="shellIdTagId" />
              <TagSelectField label={t('trace.slotTag')} cfgKey="slotTagId" filter={(tg) => tg.dataType !== 'BOOL' && tg.dataType !== 'STRING'} />
            </>
          )}

          {(type === 'filling' || type === 'probing') && (
            <TagSelectField label={t('trace.trolleyIdTag')} cfgKey="trolleyIdTagId" />
          )}

          {type === 'filling' && (
            <>
              <TagSelectField label={t('trace.rowTag')} cfgKey="rowTagId" filter={(tg) => tg.dataType !== 'BOOL' && tg.dataType !== 'STRING'} />
              <p className="text-muted" style={{ fontSize: 'var(--font-size-xs)', marginTop: 'calc(-1 * var(--space-2))', marginBottom: 'var(--space-3)' }}>
                {t('trace.rowTagHint')}
              </p>
            </>
          )}

          {/* Data/<tagAdı> — ölçüm alanları */}
          {(type === 'funnel_screwing' || type === 'filling' || type === 'probing') && config.plcId && (
            <>
              <TagMultiSelect
                label={t('trace.dataTags')}
                tags={tags}
                selectedIds={config.dataTagIds ?? []}
                onChange={(ids) => set('dataTagIds', ids)}
              />
              <p className="text-muted" style={{ fontSize: 'var(--font-size-xs)', marginTop: 'calc(-1 * var(--space-2))', marginBottom: 'var(--space-3)' }}>
                {t('trace.dataTagsHint')}
              </p>
            </>
          )}

          {/* Sonuç tag'leri (MES → PLC) */}
          {config.plcId && (
            <>
              <div style={{ fontWeight: 600, fontSize: 'var(--font-size-sm)', margin: 'var(--space-3) 0 var(--space-2) 0' }}>
                📤 {t('trace.resultTags')}
              </div>
              <div className="flex gap-3">
                <div style={{ flex: 1 }}>
                  <TagSelectField label={t('trace.ackTag')} cfgKey="ackTagId" filter={(tg) => tg.dataType === 'BOOL'} />
                </div>
                <div style={{ flex: 1 }}>
                  <TagSelectField label={t('trace.busyTag')} cfgKey="busyTagId" filter={(tg) => tg.dataType === 'BOOL'} />
                </div>
              </div>
              <div className="flex gap-3">
                <div style={{ flex: 1 }}>
                  <TagSelectField label={t('trace.errorCodeTag')} cfgKey="errorCodeTagId" filter={(tg) => tg.dataType !== 'BOOL' && tg.dataType !== 'STRING'} />
                </div>
                <div style={{ flex: 1 }}>
                  <TagSelectField label={t('trace.errorMessageTag')} cfgKey="errorMessageTagId" filter={(tg) => tg.dataType === 'STRING'} />
                </div>
              </div>
              <p className="text-muted" style={{ fontSize: 'var(--font-size-xs)', marginTop: 'calc(-1 * var(--space-2))', marginBottom: 'var(--space-3)' }}>
                {t('trace.ackErrorHint')}
              </p>
            </>
          )}
        </>
      )}

      {/* trolley_read: otomatik temizleme */}
      {type === 'trolley_read' && (
        <div style={{ marginBottom: 'var(--space-3)' }}>
          <Checkbox
            label={t('trace.clearOnRead')}
            checked={config.clearOnRead ?? true}
            onChange={(e) => set('clearOnRead', e.target.checked)}
          />
        </div>
      )}

      <Checkbox label={t('common.active')} checked={isActive} onChange={(e) => setIsActive(e.target.checked)} />
    </Modal>
  );
}
