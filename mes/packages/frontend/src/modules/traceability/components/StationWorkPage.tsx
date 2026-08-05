import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { ArrowLeft, CheckCircle2, Pencil, Printer, QrCode as QrIcon, Trash2, Zap } from 'lucide-react';
import { Alert, Badge, Button, Input, Modal, useToast } from '../../../core/components/common';
import {
  traceService,
  type LastCapture,
  type Measurement,
  type QrHistoryItem,
  type Station,
  type StationContextDto,
  type TrolleyProductItem,
} from '../services/trace.service';
import { tagService, type PlcTag } from '../../plc-gateway/services/plc.service';
import QrCode from './QrCode';
import QrLabelModal, { type QrLabelData } from './QrLabelModal';
import TrolleyGrid from './TrolleyGrid';
import MeasurementEditor from './MeasurementEditor';

/**
 * StationWorkPage — istasyon TİPİNE göre özel çalışma ekranı.
 * Tüm istasyonlar PLC'den veri alır (trigger) VE web'den manuel veri girişi
 * destekler ("PLC'den gelmiş gibi"). Ölçümler düzenlenebilir/silinebilir.
 */
export default function StationWorkPage() {
  const { t } = useTranslation();
  const { stationKey } = useParams<{ stationKey: string }>();

  const [station, setStation] = useState<Station | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Çalışma bağlamı (son araba + son yakalanan veri) — PLC'li istasyonlarda poll edilir
  const [ctx, setCtx] = useState<StationContextDto | null>(null);
  const [plcTags, setPlcTags] = useState<PlcTag[]>([]);

  const load = useCallback(async () => {
    try {
      const { stations } = await traceService.listStations();
      const s = stations.find((x) => x.key === stationKey) ?? null;
      setStation(s);
      setError(s ? null : t('trace.stationNotFound'));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [stationKey, t]);

  useEffect(() => {
    void load();
  }, [load]);

  const isPlcStation = station ? station.type !== 'qr_generate' && station.type !== 'legacy' : false;

  // PLC tag'lerini yükle (data alanı adları + önerilen ölçüm alanları için)
  useEffect(() => {
    if (!station?.config.plcId) return;
    tagService
      .list(station.config.plcId)
      .then(({ tags }) => setPlcTags(tags))
      .catch(() => setPlcTags([]));
  }, [station]);

  // Bağlamı yükle + 3 sn'de tazele (PLC trigger sonrası canlı güncellenir)
  const refreshCtx = useCallback(async () => {
    if (!station) return;
    try {
      const c = await traceService.getStationContext(station.key);
      setCtx(c);
    } catch {
      // sessiz geç
    }
  }, [station]);

  useEffect(() => {
    if (!station || !isPlcStation) return;
    void refreshCtx();
    const id = setInterval(() => void refreshCtx(), 3000);
    return () => clearInterval(id);
  }, [station, isPlcStation, refreshCtx]);

  // İstasyonun ölçüm alan adları (dataTagIds → tag adları)
  const dataFieldNames = useMemo(
    () =>
      (station?.config.dataTagIds ?? [])
        .map((id) => plcTags.find((x) => x.id === id)?.name)
        .filter((n): n is string => Boolean(n)),
    [station, plcTags]
  );

  if (loading) return <p className="text-muted">{t('common.loading')}</p>;
  if (error || !station) return <Alert variant="danger">{error ?? t('trace.stationNotFound')}</Alert>;

  return (
    <div className={`trace-sim-wrapper${station.type === 'qr_generate' ? ' full-height-scroll' : ''}`}>
      {/* ─── Üst Bar ─── */}
      <div className="trace-sim-header">
        <div className="flex items-center gap-3">
          <Link to="/trace/stations" className="btn-icon" title={t('common.back')}>
            <ArrowLeft size={18} />
          </Link>
          <div>
            <h1 style={{ fontSize: 'var(--font-size-lg)', margin: 0, fontWeight: 700 }}>{station.name}</h1>
            <div className="text-muted" style={{ fontSize: 'var(--font-size-xs)' }}>
              key: <code>{station.key}</code>
              {' • '}
              <Badge variant="info">{t(`trace.type.${station.type}`, { defaultValue: station.type })}</Badge>
            </div>
          </div>
        </div>

        {ctx?.trolley && (
          <div>
            <span className="text-muted" style={{ fontSize: 'var(--font-size-xs)' }}>{t('trace.activeTrolley')}: </span>
            <strong style={{ fontSize: 'var(--font-size-md)', fontFamily: 'var(--font-mono)' }}>{ctx.trolley.code}</strong>
            <span style={{ marginLeft: 8 }}>
              <Badge variant="info">{ctx.trolley.slots.length} / {ctx.trolley.slotCount}</Badge>
            </span>
          </div>
        )}
      </div>

      {/* ─── Tip bazlı özel panel ─── */}
      {station.type === 'qr_generate' && <QrGeneratePanel station={station} />}
      {station.type === 'trolley_read' && (
        <TrolleyReadPanel station={station} ctx={ctx} onChanged={refreshCtx} />
      )}
      {station.type === 'funnel_screwing' && (
        <FunnelScrewingPanel station={station} ctx={ctx} dataFields={dataFieldNames} onChanged={refreshCtx} />
      )}
      {station.type === 'trolley_shell_matching' && (
        <MatchingPanel station={station} ctx={ctx} onChanged={refreshCtx} />
      )}
      {(station.type === 'filling' || station.type === 'probing') && (
        <TrolleyDataPanel station={station} ctx={ctx} dataFields={dataFieldNames} onChanged={refreshCtx} />
      )}
      {!['qr_generate', 'trolley_read', 'funnel_screwing', 'trolley_shell_matching', 'filling', 'probing'].includes(station.type) && (
        <Alert variant="warning">{t('trace.unknownTypeWork', { type: station.type })}</Alert>
      )}
    </div>
  );
}

// ─── Son Yakalanan Veri kartı ────────────────────────────────────────────────

function LastCaptureCard({ capture }: { capture: LastCapture | null | undefined }) {
  const { t } = useTranslation();
  return (
    <div className="trace-panel-card">
      <div className="trace-panel-title">
        <Zap size={15} /> {t('trace.lastCapture')}
      </div>
      {!capture ? (
        <p className="text-muted" style={{ fontSize: 'var(--font-size-xs)', margin: 0 }}>{t('trace.noCapture')}</p>
      ) : (
        <>
          <div style={{ fontWeight: 700, fontFamily: 'var(--font-mono)', fontSize: 'var(--font-size-sm)' }}>{capture.summary}</div>
          {Object.keys(capture.data).length > 0 && (
            <div className="trace-capture-data">
              {Object.entries(capture.data).map(([k, v]) => (
                <div key={k} className="trace-capture-item">
                  <span className="text-muted">{k}</span>
                  <strong>{String(v)}</strong>
                </div>
              ))}
            </div>
          )}
          <div className="text-muted" style={{ fontSize: '11px', marginTop: 4 }}>
            {new Date(capture.at).toLocaleString()}
          </div>
        </>
      )}
    </div>
  );
}

// ─── Manuel Veri Girişi kartı ────────────────────────────────────────────────

interface ManualEntryProps {
  station: Station;
  dataFields: string[];
  /** Hangi kimlik alanları gösterilsin */
  showShellId?: boolean;
  showTrolleyId?: boolean;
  showSlot?: boolean;
  showRow?: boolean;
  onChanged?: () => void;
}

function ManualEntryCard({ station, dataFields, showShellId, showTrolleyId, showSlot, showRow, onChanged }: ManualEntryProps) {
  const { t } = useTranslation();
  const toast = useToast();
  const [shellId, setShellId] = useState('');
  const [trolleyId, setTrolleyId] = useState('');
  const [slotNumber, setSlotNumber] = useState('');
  const [rowNumber, setRowNumber] = useState('');
  const [values, setValues] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  const handleApply = async () => {
    setBusy(true);
    try {
      const data: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(values)) {
        if (!v.trim()) continue;
        const num = Number(v);
        data[k] = Number.isFinite(num) && v.trim() !== '' ? num : v;
      }
      const res = await traceService.triggerStation(station.key, {
        shellId: shellId.trim() || undefined,
        trolleyId: trolleyId.trim() || undefined,
        slotNumber: slotNumber ? Number(slotNumber) : undefined,
        rowNumber: rowNumber ? Number(rowNumber) : undefined,
        data,
      });
      toast.success(res.message ?? t('common.success'));
      setShellId('');
      setSlotNumber('');
      setRowNumber('');
      setValues({});
      onChanged?.();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('common.error'));
    } finally {
      setBusy(false);
    }
  };

  const canApply =
    (!showShellId || shellId.trim()) &&
    (!showTrolleyId || trolleyId.trim()) &&
    (!showSlot || Number(slotNumber) > 0) &&
    (!showRow || Number(rowNumber) > 0);

  return (
    <div className="trace-panel-card">
      <div className="trace-panel-title">
        <Pencil size={15} /> {t('trace.manualEntry')}
      </div>
      <p className="text-muted" style={{ fontSize: 'var(--font-size-xs)', marginTop: 0 }}>{t('trace.manualEntryHint')}</p>
      <div className="trace-manual-form">
        {showShellId && (
          <Input label={t('trace.shellId')} value={shellId} onChange={(e) => setShellId(e.target.value)} placeholder="SH-…" />
        )}
        {showTrolleyId && (
          <Input label={t('trace.trolleyId')} value={trolleyId} onChange={(e) => setTrolleyId(e.target.value)} placeholder="TR-001" />
        )}
        {showSlot && (
          <Input label={t('trace.slotNo')} type="number" min={1} value={slotNumber} onChange={(e) => setSlotNumber(e.target.value)} />
        )}
        {showRow && (
          <Input label={t('trace.rowNo')} type="number" min={1} value={rowNumber} onChange={(e) => setRowNumber(e.target.value)} />
        )}
        {dataFields.map((f) => (
          <Input
            key={f}
            label={f}
            value={values[f] ?? ''}
            onChange={(e) => setValues((prev) => ({ ...prev, [f]: e.target.value }))}
          />
        ))}
      </div>
      <Button className="mt-4" onClick={() => void handleApply()} disabled={busy || !canApply}>
        <CheckCircle2 size={16} /> {t('trace.apply')}
      </Button>
    </div>
  );
}

// ─── QR Kod Üretim paneli ────────────────────────────────────────────────────

function QrGeneratePanel({ station }: { station: Station }) {
  const { t } = useTranslation();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [qrLabel, setQrLabel] = useState<QrLabelData | null>(null);
  const [qrModalOpen, setQrModalOpen] = useState(false);
  const [history, setHistory] = useState<QrHistoryItem[]>([]);
  const [shellModalOpen, setShellModalOpen] = useState(false);
  const [customShellId, setCustomShellId] = useState('');
  const [shellError, setShellError] = useState<string | null>(null);

  const loadHistory = useCallback(async () => {
    try {
      const { items } = await traceService.getQrHistory(24);
      setHistory(items);
    } catch {
      // sessiz geç
    }
  }, []);

  useEffect(() => {
    void loadHistory();
  }, [loadHistory]);

  const handlePrepare = async () => {
    setBusy(true);
    setShellError(null);
    try {
      const { shellId } = await traceService.getNextShellId();
      setCustomShellId(shellId);
      setShellModalOpen(true);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('common.error'));
    } finally {
      setBusy(false);
    }
  };

  const handleCreate = async () => {
    const cleanId = customShellId.trim();
    if (!cleanId) return;
    setBusy(true);
    setShellError(null);
    try {
      const res = await traceService.triggerStation(station.key, { shellId: cleanId });
      if (res.ok && res.qrLabel) {
        setShellModalOpen(false);
        setQrLabel({ productId: res.qrLabel.productId, svgPath: res.qrLabel.svgPath, size: res.qrLabel.size });
        setQrModalOpen(true);
        toast.success(t('trace.qrGenerated', { id: cleanId }));
        void loadHistory();
      } else if (res.message) {
        setShellError(res.message);
      }
    } catch (err) {
      setShellError(err instanceof Error ? err.message : t('common.error'));
    } finally {
      setBusy(false);
    }
  };

  const labelW = station.config.labelWidth && station.config.labelWidth > 0 ? station.config.labelWidth : 50;
  const labelH = station.config.labelHeight && station.config.labelHeight > 0 ? station.config.labelHeight : 30;
  const padMm = 2;
  const textMm = 6;
  const cardQrMm = Math.max(8, Math.min(labelW - padMm * 2, labelH - padMm * 2 - textMm));

  return (
    <div className="trace-sim-body full-width-body">
      <div style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: 'var(--space-6)' }}>
        <div className="trace-qr-hero-banner">
          <div className="trace-qr-hero-icon">
            <QrIcon size={40} />
          </div>
          <div className="trace-qr-hero-content">
            <h2>{t('trace.qrGeneratorTitle')}</h2>
            <p>{t('trace.qrGeneratorHint')}</p>
          </div>
          <button className="btn-qr-hero-action" onClick={() => void handlePrepare()} disabled={busy}>
            <QrIcon size={24} />
            <span>{t('trace.generateQr')}</span>
          </button>
        </div>

        <div>
          <div className="flex items-center justify-between mb-4">
            <h3 style={{ fontSize: 'var(--font-size-lg)', fontWeight: 700, margin: 0, display: 'flex', alignItems: 'center', gap: 8 }}>
              <span>📜</span> {t('trace.qrHistory')}
            </h3>
            <Badge variant="info">{history.length}</Badge>
          </div>

          {history.length === 0 ? (
            <Alert variant="info">{t('trace.noQrHistory')}</Alert>
          ) : (
            <div className="trace-qr-history-grid">
              {history.map((item) => (
                <div key={item.productId} className="trace-qr-card">
                  <div className="trace-qr-card-header">
                    <Badge variant={item.status === 'completed' ? 'success' : item.status === 'rejected' ? 'danger' : 'info'}>
                      {t(`trace.status.${item.status}`)}
                    </Badge>
                    {item.createdAt && (
                      <span className="trace-qr-card-date">
                        {new Date(item.createdAt + (item.createdAt.endsWith('Z') ? '' : 'Z')).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      </span>
                    )}
                  </div>
                  <div className="trace-qr-card-label-wrap">
                    <div className="trace-qr-print" style={{ width: `${labelW}mm`, height: `${labelH}mm` }}>
                      <QrCode svgPath={item.svgPath} size={item.size} sizeMm={cardQrMm} />
                      <div className="trace-qr-print-text">{item.productId}</div>
                    </div>
                  </div>
                  <Button
                    variant="ghost"
                    className="w-full mt-1"
                    onClick={() => {
                      setQrLabel({ productId: item.productId, svgPath: item.svgPath, size: item.size });
                      setQrModalOpen(true);
                    }}
                  >
                    <Printer size={16} /> {t('trace.reprint')}
                  </Button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Shell ID oluşturma pop-up'ı */}
      {shellModalOpen && (
        <Modal open={shellModalOpen} title={t('trace.createShellTitle')} onClose={() => setShellModalOpen(false)}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
            {shellError && <Alert variant="danger">{shellError}</Alert>}
            <Input
              label={t('trace.shellIdLabel')}
              value={customShellId}
              onChange={(e) => {
                setCustomShellId(e.target.value);
                setShellError(null);
              }}
              placeholder="SH-20260805-0001"
              autoFocus
              onKeyDown={(e) => {
                if (e.key === 'Enter') void handleCreate();
              }}
            />
            <p className="text-muted" style={{ fontSize: 'var(--font-size-xs)', margin: 0 }}>
              💡 {t('trace.shellIdUniqueHint')}
            </p>
            <div className="flex justify-end gap-2 mt-2">
              <Button variant="ghost" onClick={() => setShellModalOpen(false)} disabled={busy}>
                {t('common.cancel')}
              </Button>
              <Button onClick={() => void handleCreate()} disabled={busy || !customShellId.trim()}>
                <CheckCircle2 size={16} /> {t('trace.createAndPrint')}
              </Button>
            </div>
          </div>
        </Modal>
      )}

      <QrLabelModal
        open={qrModalOpen && qrLabel !== null}
        label={qrLabel}
        onClose={() => setQrModalOpen(false)}
        labelWidthMm={labelW}
        labelHeightMm={labelH}
      />
    </div>
  );
}

// ─── Trolley Okuma paneli ────────────────────────────────────────────────────

interface PlcPanelProps {
  station: Station;
  ctx: StationContextDto | null;
  onChanged: () => void;
}

function TrolleyReadPanel({ station, ctx, onChanged }: PlcPanelProps) {
  const { t } = useTranslation();
  const [selectedSlot, setSelectedSlot] = useState<{ slotNumber: number; item?: TrolleyProductItem } | null>(null);

  return (
    <div className="trace-sim-body full-width-body">
      <div className="trace-panel-grid">
        <div>
          <LastCaptureCard capture={ctx?.lastCapture} />
          <div style={{ marginTop: 'var(--space-4)' }}>
            <ManualEntryCard station={station} dataFields={[]} showTrolleyId onChanged={onChanged} />
          </div>
        </div>
        <div>
          {!ctx?.trolley ? (
            <Alert variant="info">{t('trace.noTrolleyYet')}</Alert>
          ) : (
            <TrolleyGrid
              trolley={ctx.trolley}
              items={ctx.trolleyItems}
              onSlotClick={(slotNumber, item) => setSelectedSlot({ slotNumber, item })}
            />
          )}
        </div>
      </div>

      <SlotInfoModal selected={selectedSlot} onClose={() => setSelectedSlot(null)} />
    </div>
  );
}

// ─── Funnel Sıkma paneli ─────────────────────────────────────────────────────

interface DataPanelProps extends PlcPanelProps {
  dataFields: string[];
}

function FunnelScrewingPanel({ station, ctx, dataFields, onChanged }: DataPanelProps) {
  return (
    <div className="trace-sim-body full-width-body">
      <div className="trace-panel-grid">
        <div>
          <LastCaptureCard capture={ctx?.lastCapture} />
          <div style={{ marginTop: 'var(--space-4)' }}>
            <ManualEntryCard station={station} dataFields={dataFields} showShellId onChanged={onChanged} />
          </div>
        </div>
        <div>
          <RecentMeasurementsCard stationKey={station.key} />
        </div>
      </div>
    </div>
  );
}

// ─── Trolley-Shell Eşleştirme paneli ─────────────────────────────────────────

function MatchingPanel({ station, ctx, onChanged }: PlcPanelProps) {
  const { t } = useTranslation();
  const [selectedSlot, setSelectedSlot] = useState<{ slotNumber: number; item?: TrolleyProductItem } | null>(null);

  return (
    <div className="trace-sim-body full-width-body">
      <div className="trace-panel-grid">
        <div>
          <LastCaptureCard capture={ctx?.lastCapture} />
          <div style={{ marginTop: 'var(--space-4)' }}>
            <ManualEntryCard station={station} dataFields={[]} showShellId showSlot onChanged={onChanged} />
          </div>
        </div>
        <div>
          {!ctx?.trolley ? (
            <Alert variant="info">{t('trace.noTrolleyYet')}</Alert>
          ) : (
            <TrolleyGrid
              trolley={ctx.trolley}
              items={ctx.trolleyItems}
              onSlotClick={(slotNumber, item) => setSelectedSlot({ slotNumber, item })}
            />
          )}
        </div>
      </div>

      <SlotInfoModal selected={selectedSlot} onClose={() => setSelectedSlot(null)} />
    </div>
  );
}

// ─── Dolum / Problama paneli (araba bazlı ölçüm istasyonları) ────────────────

function TrolleyDataPanel({ station, ctx, dataFields, onChanged }: DataPanelProps) {
  const { t } = useTranslation();
  const [selectedSlot, setSelectedSlot] = useState<{ slotNumber: number; item?: TrolleyProductItem } | null>(null);
  const isFilling = station.type === 'filling';

  return (
    <div className="trace-sim-body full-width-body">
      <div className="trace-panel-grid">
        <div>
          <LastCaptureCard capture={ctx?.lastCapture} />
          <div style={{ marginTop: 'var(--space-4)' }}>
            <ManualEntryCard
              station={station}
              dataFields={dataFields}
              showTrolleyId
              showRow={isFilling}
              onChanged={onChanged}
            />
          </div>
        </div>
        <div>
          {!ctx?.trolley ? (
            <Alert variant="info">{t('trace.noTrolleyYet')}</Alert>
          ) : (
            <TrolleyGrid
              trolley={ctx.trolley}
              items={ctx.trolleyItems}
              onSlotClick={(slotNumber, item) => setSelectedSlot({ slotNumber, item })}
            />
          )}
        </div>
      </div>

      {/* Slot detayı — bu istasyonun ölçümleri: görüntüle/ekle/düzenle/sil */}
      <Modal
        open={selectedSlot !== null}
        title={t('trace.slotDetails', { slot: selectedSlot?.slotNumber })}
        onClose={() => setSelectedSlot(null)}
      >
        {selectedSlot?.item?.productId ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
            <div className="flex items-center justify-between pb-3" style={{ borderBottom: '1px solid var(--border-color)' }}>
              <div>
                <div className="text-muted" style={{ fontSize: 'var(--font-size-xs)' }}>{t('trace.productId')}</div>
                <div style={{ fontSize: 'var(--font-size-lg)', fontWeight: 700, fontFamily: 'var(--font-mono)' }}>
                  {selectedSlot.item.productId}
                </div>
              </div>
              <Badge variant={selectedSlot.item.status === 'completed' ? 'success' : selectedSlot.item.status === 'rejected' ? 'danger' : 'info'}>
                {t(`trace.status.${selectedSlot.item.status}`)}
              </Badge>
            </div>
            <MeasurementEditor
              shellId={selectedSlot.item.productId}
              stationKey={station.key}
              suggestedFields={dataFields}
              onChanged={onChanged}
            />
          </div>
        ) : (
          <Alert variant="info">{t('trace.slotEmptyManualHint')}</Alert>
        )}
      </Modal>
    </div>
  );
}

// ─── Son Ölçümler kartı (istasyon bazlı — düzenle/sil) ───────────────────────

function RecentMeasurementsCard({ stationKey }: { stationKey: string }) {
  const { t } = useTranslation();
  const toast = useToast();
  const [items, setItems] = useState<Measurement[]>([]);
  const [editId, setEditId] = useState<number | null>(null);
  const [editValue, setEditValue] = useState('');

  const load = useCallback(async () => {
    try {
      const { measurements } = await traceService.listStationMeasurements(stationKey, 15);
      setItems(measurements);
    } catch {
      // sessiz geç
    }
  }, [stationKey]);

  useEffect(() => {
    void load();
    const id = setInterval(() => void load(), 5000);
    return () => clearInterval(id);
  }, [load]);

  const handleUpdate = async (m: Measurement) => {
    if (!editValue.trim()) return;
    try {
      const num = Number(editValue);
      await traceService.updateMeasurement(m.id, Number.isFinite(num) && editValue.trim() !== '' ? num : editValue.trim());
      setEditId(null);
      toast.success(t('trace.measurementSaved'));
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('common.error'));
    }
  };

  const handleDelete = async (m: Measurement) => {
    try {
      await traceService.deleteMeasurement(m.id);
      toast.success(t('trace.measurementDeleted'));
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('common.error'));
    }
  };

  return (
    <div className="trace-panel-card">
      <div className="trace-panel-title">📊 {t('trace.recentMeasurements')}</div>
      {items.length === 0 ? (
        <p className="text-muted" style={{ fontSize: 'var(--font-size-xs)', margin: 0 }}>{t('trace.noMeasurements')}</p>
      ) : (
        <div className="trace-measurement-list">
          {items.map((m) => (
            <div key={m.id} className="trace-measurement-row">
              <div className="trace-measurement-field">
                <div style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--font-size-xs)' }}>{m.shellId}</div>
                <div className="text-muted" style={{ fontSize: '11px' }}>{m.field}</div>
              </div>
              {editId === m.id ? (
                <div className="flex gap-1" style={{ alignItems: 'center' }}>
                  <input
                    className="input"
                    style={{ width: 100, padding: '4px 8px', fontSize: 'var(--font-size-sm)' }}
                    value={editValue}
                    autoFocus
                    onChange={(e) => setEditValue(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') void handleUpdate(m);
                      if (e.key === 'Escape') setEditId(null);
                    }}
                  />
                  <Button small onClick={() => void handleUpdate(m)}>{t('common.save')}</Button>
                </div>
              ) : (
                <>
                  <div className="trace-measurement-value">{m.value ?? '—'}</div>
                  <div className="flex gap-1">
                    <button className="btn-icon" title={t('trace.editValue')} onClick={() => { setEditId(m.id); setEditValue(String(m.value ?? '')); }}>
                      <Pencil size={14} />
                    </button>
                    <button className="btn-icon text-danger" title={t('common.delete')} onClick={() => void handleDelete(m)}>
                      <Trash2 size={14} />
                    </button>
                  </div>
                </>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Slot bilgi pop-up'ı (trolley_read / matching — salt görüntüleme) ────────

function SlotInfoModal({ selected, onClose }: { selected: { slotNumber: number; item?: TrolleyProductItem } | null; onClose: () => void }) {
  const { t } = useTranslation();
  return (
    <Modal open={selected !== null} title={t('trace.slotDetails', { slot: selected?.slotNumber })} onClose={onClose}>
      {selected?.item?.productId ? (
        <div className="flex items-center justify-between">
          <div>
            <div className="text-muted" style={{ fontSize: 'var(--font-size-xs)' }}>{t('trace.productId')}</div>
            <div style={{ fontSize: 'var(--font-size-lg)', fontWeight: 700, fontFamily: 'var(--font-mono)' }}>
              {selected.item.productId}
            </div>
          </div>
          <Badge variant={selected.item.status === 'completed' ? 'success' : selected.item.status === 'rejected' ? 'danger' : 'info'}>
            {t(`trace.status.${selected.item.status}`)}
          </Badge>
        </div>
      ) : (
        <Alert variant="info">{t('trace.slotEmptyHint')}</Alert>
      )}
    </Modal>
  );
}
