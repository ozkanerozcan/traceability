import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Plus, Pencil, Trash2, Play, Wrench, Settings, X } from 'lucide-react';
import { Alert, Badge, Button, Checkbox, ConfirmDialog, EmptyState, Input, Modal, Select, Table, useToast } from '../../../core/components/common';
import { traceService, CAPABILITY_KEYS, type Station, type StationCapability, type StationConfig } from '../services/trace.service';
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

/** İstasyon tipini yeteneklerden OTOMATİK türetir (formdan elle seçilmez). */
function deriveType(caps: StationCapability[]): string {
  if (caps.includes('qr_generate')) return 'qr';
  if (caps.includes('trolley_read')) return 'trolley';
  if (caps.includes('plc_acquire')) return 'plc';
  if (caps.includes('wait_control')) return 'wait';
  if (caps.includes('ok_nok')) return 'check';
  if (caps.includes('batch_assign')) return 'assembly';
  return 'generic';
}

/** Konfigürasyon gerektiren yetenekler */
const CONFIGURABLE: StationCapability[] = ['qr_generate', 'trolley_read', 'plc_acquire', 'wait_control', 'batch_assign'];

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

  const [name, setName] = useState('');
  const [caps, setCaps] = useState<StationCapability[]>([]);
  const [config, setConfig] = useState<StationConfig>({});
  const [isActive, setIsActive] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [configuring, setConfiguring] = useState<StationCapability | null>(null);

  useEffect(() => {
    if (open) {
      setName(station?.name ?? '');
      setCaps(station?.capabilities ?? []);
      setConfig(station?.config ?? {});
      setIsActive(station?.isActive ?? true);
      setError(null);
      setConfiguring(null);
      if (station?.config.plcId) onPlcChange(station.config.plcId);
    }
  }, [open, station, onPlcChange]);

  // Anahtar: düzenlemede mevcut, yeni kayıtta isimden otomatik üretilir
  const key = isEdit ? station.key : slugify(name);
  const type = deriveType(caps);

  const toggleCap = (c: StationCapability) => {
    setCaps((prev) => (prev.includes(c) ? prev.filter((x) => x !== c) : [...prev, c]));
  };
  const removeCap = (c: StationCapability) => {
    setCaps((prev) => prev.filter((x) => x !== c));
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
          capabilities: caps,
          config,
        });
      } else {
        await traceService.createStation({ key, name: name.trim(), type, capabilities: caps, config });
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
    <>
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

        {/* Anahtar + Tip — otomatik (elle girilmez) */}
        <div className="text-muted" style={{ fontSize: 'var(--font-size-xs)', marginTop: 'calc(-1 * var(--space-2))', marginBottom: 'var(--space-4)' }}>
          {t('trace.stationKey')}: <span style={{ fontFamily: 'var(--font-mono)' }}>{key || '—'}</span>
          {'  •  '}
          {t('trace.stationType')}: {t(`trace.type.${type}`)}
          {'  '}
          <span>({t('trace.autoDerived')})</span>
        </div>

        {/* Atanan yetenekler */}
        <div className="form-group">
          <span className="form-label">{t('trace.capabilities')}</span>
          <div className="trace-cap-chips">
            {caps.map((c) => (
              <div key={c} className="trace-cap-chip">
                <span className="trace-cap-chip-label">{t(`trace.cap.${c}`)}</span>
                {CONFIGURABLE.includes(c) && (
                  <button
                    type="button"
                    className="btn-icon trace-cap-chip-btn"
                    title={t('trace.configureCapability')}
                    onClick={() => setConfiguring(c)}
                  >
                    <Settings size={13} />
                  </button>
                )}
                <button
                  type="button"
                  className="btn-icon trace-cap-chip-btn"
                  title={t('common.delete')}
                  onClick={() => removeCap(c)}
                >
                  <X size={13} />
                </button>
              </div>
            ))}
            <button type="button" className="trace-cap-add" onClick={() => setPickerOpen(true)}>
              <Plus size={14} /> {t('trace.addCapability')}
            </button>
          </div>
          {caps.length === 0 && (
            <p className="text-muted" style={{ fontSize: 'var(--font-size-xs)' }}>{t('trace.noCapabilities')}</p>
          )}
        </div>

        <Checkbox label={t('common.active')} checked={isActive} onChange={(e) => setIsActive(e.target.checked)} />
      </Modal>

      {/* Yetenek seçimi (çoklu) — iç içe pop-up */}
      <CapabilityPicker
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
        caps={caps}
        onToggle={toggleCap}
      />

      {/* Yetenek konfigürasyonu — iç içe pop-up */}
      <CapabilityConfig
        cap={configuring}
        onClose={() => setConfiguring(null)}
        config={config}
        onChange={setConfig}
        plcs={plcs}
        tags={tags}
        onPlcChange={onPlcChange}
      />
    </>
  );
}

// ─── Yetenek Seçici (çoklu) ─────────────────────────────────────────────────

interface CapabilityPickerProps {
  open: boolean;
  onClose: () => void;
  caps: StationCapability[];
  onToggle: (c: StationCapability) => void;
}

function CapabilityPicker({ open, onClose, caps, onToggle }: CapabilityPickerProps) {
  const { t } = useTranslation();
  return (
    <Modal
      open={open}
      title={t('trace.selectCapabilities')}
      onClose={onClose}
      modalStack
      footer={<Button onClick={onClose}>{t('common.confirm')}</Button>}
    >
      <div className="form-group">
        <div className="flex gap-3" style={{ flexWrap: 'wrap', flexDirection: 'column', alignItems: 'flex-start' }}>
          {CAPABILITY_KEYS.map((c) => (
            <Checkbox key={c} label={t(`trace.cap.${c}`)} checked={caps.includes(c)} onChange={() => onToggle(c)} />
          ))}
        </div>
      </div>
    </Modal>
  );
}

// ─── Yetenek Konfigürasyonu ─────────────────────────────────────────────────

interface CapabilityConfigProps {
  cap: StationCapability | null;
  onClose: () => void;
  config: StationConfig;
  onChange: (c: StationConfig) => void;
  plcs: PlcProfile[];
  tags: PlcTag[];
  onPlcChange: (plcId: number) => void;
}

function CapabilityConfig({ cap, onClose, config, onChange, plcs, tags, onPlcChange }: CapabilityConfigProps) {
  const { t } = useTranslation();
  if (!cap) return null;

  const set = <K extends keyof StationConfig>(key: K, value: StationConfig[K] | undefined) => {
    onChange({ ...config, [key]: value });
  };

  const shellSrc: 'scan' | 'plc' | 'trolley' = config.shellIdSource ?? 'scan';

  return (
    <Modal
      open={cap !== null}
      title={t('trace.configureCapabilityTitle', { cap: t(`trace.cap.${cap}`) })}
      onClose={onClose}
      modalStack
      footer={<Button onClick={onClose}>{t('common.save')}</Button>}
    >
      {/* QR Üretimi — etiket boyutu */}
      {cap === 'qr_generate' && (
        <div className="flex gap-3">
          <div style={{ flex: 1 }}>
            <Input label={t('trace.labelWidth')} type="number" min={10} max={300} value={config.labelWidth ?? 50} onChange={(e) => set('labelWidth', Number(e.target.value))} />
          </div>
          <div style={{ flex: 1 }}>
            <Input label={t('trace.labelHeight')} type="number" min={10} max={300} value={config.labelHeight ?? 30} onChange={(e) => set('labelHeight', Number(e.target.value))} />
          </div>
        </div>
      )}

      {/* Araba Okuma — otomatik temizleme */}
      {cap === 'trolley_read' && (
        <Checkbox
          label={t('trace.clearOnRead')}
          checked={config.clearOnRead ?? true}
          onChange={(e) => set('clearOnRead', e.target.checked)}
        />
      )}

      {/* Bekleme Kontrolü — süre */}
      {cap === 'wait_control' && (
        <Input label={t('trace.waitHours')} type="number" min={1} value={config.waitHours ?? 24} onChange={(e) => set('waitHours', Number(e.target.value))} />
      )}

      {/* Parti Bağlama — bileşen tipi */}
      {cap === 'batch_assign' && (
        <Select label={t('trace.componentKind')} value={config.componentKind ?? 'material'} onChange={(e) => set('componentKind', e.target.value as 'material' | 'component')}>
          <option value="material">{t('trace.kind.material')}</option>
          <option value="component">{t('trace.kind.component')}</option>
        </Select>
      )}

      {/* PLC Data — tam konfigürasyon */}
      {cap === 'plc_acquire' && (
        <>
          {/* PLC Seçimi */}
          <Select
            label={t('trace.plc')}
            value={config.plcId ?? ''}
            onChange={(e) => {
              const v = e.target.value ? Number(e.target.value) : undefined;
              onChange({ ...config, plcId: v, triggerTagId: undefined, shellIdTagId: undefined, rowTagId: undefined, dataTagIds: [] });
              if (v) onPlcChange(v);
            }}
          >
            {plcs.length === 0 ? (
              <option value="" disabled>{t('trace.noPlcAvailable')}</option>
            ) : null}
            {plcs.map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </Select>

          {/* Trigger Biti — yalnız subscribe + BOOL */}
          <Select
            label={t('trace.triggerTag')}
            value={config.triggerTagId ?? ''}
            onChange={(e) => set('triggerTagId', e.target.value ? Number(e.target.value) : undefined)}
            disabled={!config.plcId}
          >
            {config.plcId && tags.filter((tg) => tg.acquisitionMode === 'subscribe' && tg.dataType === 'BOOL').length === 0 ? (
              <option value="" disabled>{t('trace.noBoolTag')}</option>
            ) : null}
            {tags.filter((tg) => tg.acquisitionMode === 'subscribe' && tg.dataType === 'BOOL').map((tg) => (
              <option key={tg.id} value={tg.id}>{tg.name}</option>
            ))}
          </Select>

          {/* Shell ID Kaynağı */}
          <Select
            label={t('trace.shellIdSource')}
            value={shellSrc}
            onChange={(e) => set('shellIdSource', e.target.value === 'scan' ? undefined : (e.target.value as 'plc' | 'trolley'))}
            disabled={!config.plcId}
          >
            <option value="scan">{t('trace.src.scan')}</option>
            <option value="plc">{t('trace.src.plc')}</option>
            <option value="trolley">{t('trace.src.trolley')}</option>
          </Select>

          <p className="text-muted" style={{ fontSize: 'var(--font-size-xs)', marginTop: 'calc(-1 * var(--space-2))' }}>
            {t('trace.triggerSubscribeHint')}
          </p>

          {shellSrc === 'plc' && (
            <Select label={t('trace.shellIdTag')} value={config.shellIdTagId ?? ''} onChange={(e) => set('shellIdTagId', e.target.value ? Number(e.target.value) : undefined)} disabled={!config.plcId}>
              <option value="">{t('trace.noTag')}</option>
              {tags.map((tg) => (
                <option key={tg.id} value={tg.id}>{tg.name}</option>
              ))}
            </Select>
          )}

          {shellSrc === 'trolley' && (
            <div className="flex gap-3">
              <div style={{ flex: 1 }}>
                <Select label={t('trace.trolleyMatch')} value={config.trolleyMatchMode ?? 'all'} onChange={(e) => set('trolleyMatchMode', e.target.value as 'row' | 'all')}>
                  <option value="all">{t('trace.match.all')}</option>
                  <option value="row">{t('trace.match.row')}</option>
                </Select>
              </div>
              {(config.trolleyMatchMode ?? 'all') === 'row' && (
                <>
                  <div style={{ flex: 1 }}>
                    <Select label={t('trace.rowTag')} value={config.rowTagId ?? ''} onChange={(e) => set('rowTagId', e.target.value ? Number(e.target.value) : undefined)} disabled={!config.plcId}>
                      <option value="">{t('trace.noTag')}</option>
                      {tags.map((tg) => (
                        <option key={tg.id} value={tg.id}>{tg.name}</option>
                      ))}
                    </Select>
                  </div>
                  <div style={{ flex: 1 }}>
                    <Input label={t('trace.rowSize')} type="number" min={1} max={20} value={config.rowSize ?? 4} onChange={(e) => set('rowSize', Number(e.target.value))} />
                  </div>
                </>
              )}
            </div>
          )}

          {config.plcId && (
            <TagMultiSelect
              label={t('trace.dataTags')}
              tags={tags}
              selectedIds={config.dataTagIds ?? []}
              onChange={(ids) => set('dataTagIds', ids)}
              disabled={!config.plcId}
            />
          )}
        </>
      )}
    </Modal>
  );
}
