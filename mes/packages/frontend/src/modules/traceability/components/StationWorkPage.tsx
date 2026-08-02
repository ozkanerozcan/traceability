import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { ArrowLeft, CheckCircle2, RefreshCw } from 'lucide-react';
import { Alert, Badge, Button, Input, Modal, Table, useToast } from '../../../core/components/common';
import { traceService, type LastCapture, type QrHistoryItem, type ScanInput, type Station, type TrolleyContext, type TrolleyProductItem } from '../services/trace.service';
import { tagService, type PlcTag } from '../../plc-gateway/services/plc.service';
import QrCode from './QrCode';
import QrLabelModal, { type QrLabelData } from './QrLabelModal';

export default function StationWorkPage() {
  const { t } = useTranslation();
  const toast = useToast();
  const { stationKey } = useParams<{ stationKey: string }>();

  const [station, setStation] = useState<Station | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; message?: string; alarm?: boolean } | null>(null);

  // ─── Yetenek kartları state'i ───
  // trolley_read
  const [trolleyInput, setTrolleyInput] = useState('');
  const [trolleyCtx, setTrolleyCtx] = useState<TrolleyContext | null>(null);
  const [trolleyItems, setTrolleyItems] = useState<TrolleyProductItem[]>([]);

  // Slot Tıklama Pop-up Modal State'i
  const [selectedSlot, setSelectedSlot] = useState<{ slotNumber: number; product?: TrolleyProductItem } | null>(null);

  // plc_acquire
  const [plcTags, setPlcTags] = useState<PlcTag[]>([]);

  // QR etiket önizleme + geçmiş
  const [qrLabel, setQrLabel] = useState<QrLabelData | null>(null);
  const [qrModalOpen, setQrModalOpen] = useState(false);
  const [history, setHistory] = useState<QrHistoryItem[]>([]);

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

  const caps = station?.capabilities ?? [];
  const has = (c: string) => caps.includes(c as never);
  const storageKey = station ? `trace_trolley_${station.key}` : '';

  // ─── QR geçmişi ───
  const loadHistory = useCallback(async () => {
    try {
      const { items } = await traceService.getQrHistory(24);
      setHistory(items);
    } catch {
      // sessiz geç
    }
  }, []);

  useEffect(() => {
    if (has('qr_generate')) void loadHistory();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [station]);

  // ─── trolley_read: kayıtlı arabayı geri yükle ───
  useEffect(() => {
    if (!station || !has('trolley_read')) return;
    const restore = async () => {
      try {
        const { trolley, trolleyItems: items } = await traceService.getStationContext(station.key);
        if (trolley) {
          setTrolleyCtx(trolley);
          if (items) setTrolleyItems(items);
          localStorage.setItem(storageKey, trolley.code);
          return;
        }
      } catch {
        // yok say
      }
      const saved = localStorage.getItem(storageKey);
      if (saved) {
        try {
          const { trolley } = await traceService.confirmTrolley(station.key, saved);
          setTrolleyCtx(trolley);
          const { trolleyItems: items } = await traceService.getStationContext(station.key);
          if (items) setTrolleyItems(items);
        } catch {
          localStorage.removeItem(storageKey);
        }
      }
    };
    void restore();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [station]);

  // ─── plc_acquire: tag isimlerini yükle ───
  useEffect(() => {
    if (!station || !has('plc_acquire') || !station.config.plcId) return;
    tagService
      .list(station.config.plcId)
      .then(({ tags }) => setPlcTags(tags))
      .catch(() => setPlcTags([]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [station]);

  // ─── Bağlamı periyodik tazele (araba slotları + aktif ürün + canlı veriler) ───
  useEffect(() => {
    if (!station || (!has('trolley_read') && !has('plc_acquire'))) return;
    const id = setInterval(async () => {
      try {
        const { trolley, trolleyItems: items } = await traceService.getStationContext(station.key);
        setTrolleyCtx(trolley);
        if (items) setTrolleyItems(items);
      } catch {
        // sessiz geç
      }
    }, 3000);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [station]);

  // ─── Araba onayı ───
  const handleConfirmTrolley = async () => {
    if (!station || !trolleyInput.trim()) return;
    setBusy(true);
    try {
      const { trolley } = await traceService.confirmTrolley(station.key, trolleyInput.trim());
      setTrolleyCtx(trolley);
      const { trolleyItems: items } = await traceService.getStationContext(station.key);
      if (items) setTrolleyItems(items);
      localStorage.setItem(storageKey, trolley.code);
      setTrolleyInput('');
      toast.success(t('trace.trolleyConfirmed', { code: trolley.code }));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('common.error'));
    } finally {
      setBusy(false);
    }
  };

  // ─── Araba Değiştir ───
  const handleChangeTrolley = async () => {
    setTrolleyCtx(null);
    setTrolleyItems([]);
    localStorage.removeItem(storageKey);
    if (station) {
      try {
        await traceService.clearTrolley(station.key);
      } catch {
        // sessiz geç
      }
    }
  };

  const tagName = (id?: number) => plcTags.find((x) => x.id === id)?.name ?? (id ? `#${id}` : '—');

  if (loading) return <p className="text-muted">{t('common.loading')}</p>;
  if (error || !station) return <Alert variant="danger">{error ?? t('trace.stationNotFound')}</Alert>;

  return (
    <div className="trace-sim-wrapper">
      {/* ─── Top Bar: İstasyon & Araba Bilgisi ─── */}
      <div className="trace-sim-header">
        <div className="flex items-center gap-3">
          <Link to="/trace/stations" className="btn-icon" title={t('common.back')}>
            <ArrowLeft size={18} />
          </Link>
          <div>
            <h1 style={{ fontSize: 'var(--font-size-lg)', margin: 0, fontWeight: 700 }}>{station.name}</h1>
            <div className="text-muted" style={{ fontSize: 'var(--font-size-xs)' }}>
              key: <code>{station.key}</code>
              {station.config.triggerTagId ? ` • Trigger: ${tagName(station.config.triggerTagId)}` : ''}
            </div>
          </div>
        </div>

        {/* Aktif Araba Kontrolü */}
        {trolleyCtx && (
          <div className="flex items-center gap-3">
            <div>
              <span className="text-muted" style={{ fontSize: 'var(--font-size-xs)' }}>{t('trace.activeTrolley')}: </span>
              <strong style={{ fontSize: 'var(--font-size-md)', fontFamily: 'var(--font-mono)' }}>{trolleyCtx.code}</strong>
              <span style={{ marginLeft: 8 }}>
                <Badge variant="info">
                  {trolleyCtx.slots.length} / {trolleyCtx.slotCount} Dolu
                </Badge>
              </span>
            </div>
            <Button variant="ghost" className="btn-sm" onClick={() => void handleChangeTrolley()}>
              <RefreshCw size={14} /> {t('trace.changeTrolley')}
            </Button>
          </div>
        )}
      </div>

      {result && (
        <Alert variant={result.ok ? (result.alarm ? 'warning' : 'success') : 'danger'}>
          {result.message}
        </Alert>
      )}

      {/* ─── Simülasyon Gövdesi (%100 Fit, Zero Scroll) ─── */}
      <div className="trace-sim-body">
        {!trolleyCtx ? (
          <div style={{ maxWidth: 420, margin: 'auto', width: '100%' }}>
            <h3 style={{ marginBottom: 'var(--space-4)', textAlign: 'center' }}>{t('trace.confirmTrolleyFirst')}</h3>
            <Input
              label={t('trace.trolleyCode')}
              value={trolleyInput}
              onChange={(e) => setTrolleyInput(e.target.value)}
              placeholder="TR-001"
              autoFocus
              onKeyDown={(e) => {
                if (e.key === 'Enter') void handleConfirmTrolley();
              }}
            />
            <Button className="w-full mt-4" onClick={() => void handleConfirmTrolley()} disabled={busy || !trolleyInput.trim()}>
              <CheckCircle2 size={16} /> {t('common.confirm')}
            </Button>
          </div>
        ) : (
          <div className="trace-sim-grid">
            {Array.from({ length: trolleyCtx.slotCount }, (_, i) => {
              const slotNumber = i + 1;
              const slotItem = trolleyItems.find((x) => x.slotNumber === slotNumber);
              const filled = Boolean(slotItem || trolleyCtx.slots.some((s) => s.slot_number === slotNumber));
              const productId = slotItem?.productId ?? trolleyCtx.slots.find((s) => s.slot_number === slotNumber)?.product_id;

              return (
                <div
                  key={slotNumber}
                  className={`trace-sim-slot${filled ? ' filled' : ''}`}
                  onClick={() => setSelectedSlot({ slotNumber, product: slotItem })}
                  title={`Slot #${slotNumber} — Tıklayarak PLC verilerini görün`}
                >
                  <div className="trace-sim-slot-num">#{slotNumber}</div>
                  {filled ? (
                    <div className="trace-sim-slot-product">{productId}</div>
                  ) : (
                    <Badge variant="muted">Boş</Badge>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* ─── Slot Detay Pop-up Modalı ─── */}
      {selectedSlot && (
        <Modal
          open={Boolean(selectedSlot)}
          title={t('trace.slotDetails', { slot: selectedSlot.slotNumber })}
          onClose={() => setSelectedSlot(null)}
        >
          {selectedSlot.product ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-5)' }}>
              {/* Ürün Üst Kimlik Kartı */}
              <div className="flex items-center justify-between pb-3" style={{ borderBottom: '1px solid var(--border-color)' }}>
                <div>
                  <div className="text-muted" style={{ fontSize: 'var(--font-size-xs)' }}>{t('trace.productId')}</div>
                  <div style={{ fontSize: 'var(--font-size-lg)', fontWeight: 700, fontFamily: 'var(--font-mono)' }}>
                    {selectedSlot.product.productId}
                  </div>
                </div>
                <Badge variant={selectedSlot.product.status === 'completed' ? 'success' : selectedSlot.product.status === 'rejected' ? 'danger' : 'info'}>
                  {t(`trace.status.${selectedSlot.product.status}`)}
                </Badge>
              </div>

              {/* ─── 1. PLC'den Okunan Değerler ─── */}
              <div>
                <div style={{ fontWeight: 600, fontSize: 'var(--font-size-sm)', marginBottom: 'var(--space-3)', display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span style={{ color: 'var(--accent)' }}>⚡</span> {t('trace.plcDataTitle')}
                </div>
                {(() => {
                  const plcItems: { name: string; value: unknown; station: string }[] = [];
                  selectedSlot.product.records.forEach((r) => {
                    if (!r.data) return;
                    Object.entries(r.data).forEach(([k, v]) => {
                      if (v === null || v === undefined) return;
                      const tagId = Number(k.replace('tag_', ''));
                      const name = tagId ? tagName(tagId) : k;
                      plcItems.push({ name, value: v, station: r.stationName });
                    });
                  });

                  if (plcItems.length === 0) {
                    return <p className="text-muted" style={{ fontSize: 'var(--font-size-xs)' }}>{t('trace.noPlcDataForSlot')}</p>;
                  }

                  return (
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 'var(--space-2)' }}>
                      {plcItems.map((item, idx) => (
                        <div
                          key={idx}
                          style={{
                            background: 'var(--bg-input)',
                            padding: 'var(--space-2) var(--space-3)',
                            borderRadius: 'var(--radius-sm)',
                            border: '1px solid var(--border-color)',
                          }}
                        >
                          <div className="text-muted" style={{ fontSize: '11px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                            {item.name} <span style={{ opacity: 0.7 }}>({item.station})</span>
                          </div>
                          <div style={{ fontWeight: 700, fontFamily: 'var(--font-mono)', fontSize: 'var(--font-size-sm)', color: 'var(--text-primary)', marginTop: 2 }}>
                            {String(item.value)}
                          </div>
                        </div>
                      ))}
                    </div>
                  );
                })()}
              </div>

              {/* ─── 2. Ürün İstasyon Geçmişi ─── */}
              <div>
                <div style={{ fontWeight: 600, fontSize: 'var(--font-size-sm)', marginBottom: 'var(--space-3)' }}>
                  📜 {t('trace.stationHistoryTitle')}
                </div>
                {selectedSlot.product.records.length === 0 ? (
                  <p className="text-muted" style={{ fontSize: 'var(--font-size-xs)' }}>{t('trace.noStationHistory')}</p>
                ) : (
                  <Table>
                    <thead>
                      <tr>
                        <th>{t('trace.station')}</th>
                        <th>{t('common.status')}</th>
                        <th>{t('trace.timestamp')}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {selectedSlot.product.records.map((r, idx) => (
                        <tr key={idx}>
                          <td style={{ fontWeight: 600 }}>{r.stationName}</td>
                          <td>
                            <Badge variant={r.status === 'nok' || r.status === 'rejected' ? 'danger' : 'success'}>
                              {r.status?.toUpperCase() ?? 'OK'}
                            </Badge>
                          </td>
                          <td className="text-muted" style={{ fontSize: 'var(--font-size-xs)' }}>
                            {new Date(r.createdAt + 'Z').toLocaleString()}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </Table>
                )}
              </div>
            </div>
          ) : (
            <Alert variant="info">{t('trace.slotEmptyHint')}</Alert>
          )}
        </Modal>
      )}

      {/* ─── QR etiket önizleme + yazdırma ─── */}
      <QrLabelModal open={qrModalOpen && qrLabel !== null} label={qrLabel} onClose={() => setQrModalOpen(false)} />
    </div>
  );
}
