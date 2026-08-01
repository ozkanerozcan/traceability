import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { ArrowLeft, Printer, CheckCircle2, XCircle, RefreshCw, ScanLine } from 'lucide-react';
import { Alert, Badge, Button, Card, Input, useToast } from '../../../core/components/common';
import { traceService, type LastCapture, type QrHistoryItem, type ScanInput, type Station, type TrolleyContext } from '../services/trace.service';
import { tagService, type PlcTag } from '../../plc-gateway/services/plc.service';
import QrCode from './QrCode';
import QrLabelModal, { type QrLabelData } from './QrLabelModal';

/**
 * İstasyon çalışma ekranı — HER YETENEK (capability) AYRI BİR KARTTA gösterilir.
 * - qr_generate: QR Üret → mm boyutlu önizleme pop-up + yazdır; altta önceki QR'lar.
 * - trolley_read (Araba Okuma): araba onaylanır (sabit, localStorage'da) → okutulan
 *   her ürün bu arabaya işlenir.
 * - plc_acquire (PLC Data): ürün okutulunca AKTİF olur; trigger biti true olunca
 *   seçili tag'ler PLC'den ürüne yazılır.
 */
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
  const [trolleyProduct, setTrolleyProduct] = useState('');
  // plc_acquire
  const [plcProduct, setPlcProduct] = useState('');
  const [activeProductId, setActiveProductId] = useState<string | null>(null);
  const [lastCapture, setLastCapture] = useState<LastCapture | null>(null);
  const [plcTags, setPlcTags] = useState<PlcTag[]>([]);
  // batch_assign
  const [batchProduct, setBatchProduct] = useState('');
  const [batchNo, setBatchNo] = useState('');
  // ok_nok
  const [okNokProduct, setOkNokProduct] = useState('');
  // wait_control
  const [waitTrolley, setWaitTrolley] = useState('');
  const [direction, setDirection] = useState<'entry' | 'exit'>('entry');

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
  // PLC Read — Shell ID kaynağı (yoksa 'scan')
  const shellSrc: 'scan' | 'plc' | 'trolley' = station?.config.shellIdSource ?? 'scan';
  // Ürün taraması gösterilsin mi? (trolley kaynaklı PLC Read'de ürünler arabaya PLC ile dolar — manuel tarama yok)
  const showProductScan = !(has('plc_acquire') && shellSrc === 'trolley');

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

  // ─── trolley_read: kayıtlı arabayı geri yükle (localStorage → backend onayı) ───
  useEffect(() => {
    if (!station || !has('trolley_read')) return;
    const restore = async () => {
      // Önce backend bağlamına bak
      try {
        const { trolley } = await traceService.getStationContext(station.key);
        if (trolley) {
          setTrolleyCtx(trolley);
          localStorage.setItem(storageKey, trolley.code);
          return;
        }
      } catch {
        // yok say
      }
      // Backend'de yoksa localStorage'daki kod ile yeniden onayla
      const saved = localStorage.getItem(storageKey);
      if (saved) {
        try {
          const { trolley } = await traceService.confirmTrolley(station.key, saved);
          setTrolleyCtx(trolley);
        } catch {
          localStorage.removeItem(storageKey);
        }
      }
    };
    void restore();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [station]);

  // ─── plc_acquire: tag isimlerini yükle (config gösterimi) ───
  useEffect(() => {
    if (!station || !has('plc_acquire') || !station.config.plcId) return;
    tagService
      .list(station.config.plcId)
      .then(({ tags }) => setPlcTags(tags))
      .catch(() => setPlcTags([]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [station]);

  // ─── Bağlamı periyodik tazele (araba slotları + aktif ürün) ───
  useEffect(() => {
    if (!station || (!has('trolley_read') && !has('plc_acquire'))) return;
    const id = setInterval(async () => {
      try {
        const { trolley, productId, lastCapture: lc } = await traceService.getStationContext(station.key);
        if (trolley) setTrolleyCtx(trolley);
        setActiveProductId(productId);
        setLastCapture(lc ?? null);
      } catch {
        // sessiz geç
      }
    }, 3000);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [station]);

  // ─── Ortak tarama ───
  const doScan = async (input: Omit<ScanInput, 'stationKey'>) => {
    if (!station) return;
    setBusy(true);
    setResult(null);
    try {
      const res = await traceService.scan({ stationKey: station.key, ...input });
      setResult({ ok: true, message: res.message, alarm: res.alarm });
      if (res.qrLabel) {
        setQrLabel(res.qrLabel);
        setQrModalOpen(true);
        void loadHistory();
      }
      toast.success(res.message ?? t('common.success'));
    } catch (err) {
      const msg = err instanceof Error ? err.message : t('common.error');
      setResult({ ok: false, message: msg });
      toast.error(msg);
    } finally {
      setBusy(false);
    }
  };

  // ─── trolley_read: araba onayı ───
  const handleConfirmTrolley = async () => {
    if (!station || !trolleyInput.trim()) return;
    setBusy(true);
    try {
      const { trolley } = await traceService.confirmTrolley(station.key, trolleyInput.trim());
      setTrolleyCtx(trolley);
      localStorage.setItem(storageKey, trolley.code);
      setTrolleyInput('');
      toast.success(t('trace.trolleyConfirmed', { code: trolley.code }));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('common.error'));
    } finally {
      setBusy(false);
    }
  };

  const handleChangeTrolley = () => {
    setTrolleyCtx(null);
    localStorage.removeItem(storageKey);
  };

  const openFromHistory = (item: QrHistoryItem) => {
    setQrLabel({ productId: item.productId, svgPath: item.svgPath, size: item.size });
    setQrModalOpen(true);
  };

  const tagName = (id?: number) => plcTags.find((x) => x.id === id)?.name ?? (id ? `#${id}` : '—');

  if (loading) {
    return <p className="text-muted">{t('common.loading')}</p>;
  }

  if (error || !station) {
    return (
      <div>
        <Alert variant="danger" className="mb-4">{error ?? t('trace.stationNotFound')}</Alert>
        <Link to="/trace/stations" className="btn-icon"><ArrowLeft size={18} /></Link>
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-center gap-3 mb-4" style={{ flexWrap: 'wrap' }}>
        <Link to="/trace/stations" className="btn-icon" title={t('trace.stations')}>
          <ArrowLeft size={18} />
        </Link>
        <div style={{ flex: 1, minWidth: 0 }}>
          <h1 style={{ fontSize: 'var(--font-size-2xl)' }}>{station.name}</h1>
          <div className="flex gap-1" style={{ flexWrap: 'wrap', marginTop: 4 }}>
            {caps.map((c) => (
              <Badge key={c} variant="info">{t(`trace.cap.${c}`)}</Badge>
            ))}
          </div>
        </div>
      </div>

      {result && (
        <Alert variant={result.ok ? (result.alarm ? 'warning' : 'success') : 'danger'} className="mb-4">
          {result.message}
        </Alert>
      )}

      {/* ─── Her yetenek ayrı kartta ─── */}
      <div className="trace-work-grid">
        {/* QR Üretimi */}
        {has('qr_generate') && (
          <Card title={t('trace.cap.qr_generate')}>
            <p className="text-muted mb-4" style={{ fontSize: 'var(--font-size-sm)' }}>
              {t('trace.qrCardHint')}
            </p>
            <Button onClick={() => doScan({})} disabled={busy}>
              <Printer size={16} /> {busy ? t('common.loading') : t('trace.generateQr')}
            </Button>
          </Card>
        )}

        {/* Araba Okuma */}
        {has('trolley_read') && (
          <Card title={t('trace.cap.trolley_read')}>
            {!trolleyCtx ? (
              <>
                <Input
                  label={t('trace.trolleyCode')}
                  value={trolleyInput}
                  onChange={(e) => setTrolleyInput(e.target.value)}
                  placeholder={t('trace.scanTrolley')}
                  autoFocus
                  onKeyDown={(e) => e.key === 'Enter' && handleConfirmTrolley()}
                />
                <Button onClick={handleConfirmTrolley} disabled={busy || !trolleyInput.trim()}>
                  <CheckCircle2 size={16} /> {t('trace.confirmTrolley')}
                </Button>
              </>
            ) : (
              <>
                <div className="trace-trolley-ctx">
                  <div className="trace-trolley-ctx-code">{trolleyCtx.code}</div>
                  <div className="text-muted" style={{ fontSize: 'var(--font-size-sm)' }}>
                    {t('trace.filledSlots', { filled: trolleyCtx.slots.length, total: trolleyCtx.slotCount })}
                    {trolleyCtx.nextFreeSlot ? ` • ${t('trace.nextSlot')}: ${trolleyCtx.nextFreeSlot}` : ` • ${t('trace.trolleyFull')}`}
                  </div>
                  <Button variant="ghost" small onClick={handleChangeTrolley}>
                    <RefreshCw size={14} /> {t('trace.changeTrolley')}
                  </Button>
                </div>

                {/* Shell (slot) yerleşim ızgarası — PLC verisi geldikçe canlı dolar */}
                <div className="form-group">
                  <span className="form-label">{t('trace.shellLayout')}</span>
                  <div className="trace-slot-grid">
                    {Array.from({ length: trolleyCtx.slotCount }, (_, i) => i + 1).map((n) => {
                      const filled = trolleyCtx.slots.find((s) => s.slot_number === n);
                      return (
                        <div
                          key={n}
                          className={`trace-slot${filled ? ' filled' : ''}`}
                          title={filled ? filled.product_id : t('trace.emptySlot')}
                        >
                          {n}
                        </div>
                      );
                    })}
                  </div>
                </div>

                {showProductScan && (
                  <>
                    <Input
                      label={t('trace.productId')}
                      value={trolleyProduct}
                      onChange={(e) => setTrolleyProduct(e.target.value)}
                      placeholder={t('trace.scanProduct')}
                      autoFocus
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && trolleyProduct.trim()) {
                          void doScan({ productId: trolleyProduct.trim() });
                          setTrolleyProduct('');
                        }
                      }}
                    />
                    <Button
                      onClick={() => {
                        void doScan({ productId: trolleyProduct.trim() });
                        setTrolleyProduct('');
                      }}
                      disabled={busy || !trolleyProduct.trim()}
                    >
                      <ScanLine size={16} /> {t('trace.processProduct')}
                    </Button>
                  </>
                )}
              </>
            )}
          </Card>
        )}

        {/* PLC Data */}
        {has('plc_acquire') && (
          <Card title={t('trace.cap.plc_acquire')}>
            <div className="text-muted mb-4" style={{ fontSize: 'var(--font-size-sm)' }}>
              <div>{t('trace.shellIdSource')}: <strong>{t(`trace.src.${shellSrc}`)}</strong></div>
              <div>{t('trace.triggerTag')}: <strong>{tagName(station.config.triggerTagId)}</strong></div>
              {shellSrc === 'plc' && station.config.shellIdTagId ? (
                <div>{t('trace.shellIdTag')}: <strong>{tagName(station.config.shellIdTagId)}</strong></div>
              ) : null}
              {shellSrc === 'scan' && station.config.slotTagId ? (
                <div>{t('trace.slotTag')}: <strong>{tagName(station.config.slotTagId)}</strong></div>
              ) : null}
              {shellSrc === 'trolley' ? (
                <div>{t('trace.trolleyMatch')}: <strong>{t(`trace.match.${station.config.trolleyMatchMode ?? 'all'}`)}</strong></div>
              ) : null}
              <div>
                {t('trace.dataTags')}: {(station.config.dataTagIds ?? []).length > 0
                  ? (station.config.dataTagIds ?? []).map((id) => tagName(id)).join(', ')
                  : '—'}
              </div>
            </div>

            {activeProductId && (
              <Alert variant="info" className="mb-4">
                {t('trace.waitingPlc', { product: activeProductId })}
              </Alert>
            )}

            {/* Son yakalanan veri (trigger'dan) */}
            {lastCapture && (
              <div className="trace-last-capture">
                <div className="trace-last-capture-title">{t('trace.lastCapture')}</div>
                <div className="trace-last-capture-body">
                  <span className="trace-last-capture-product">{lastCapture.productId}</span>
                  {lastCapture.slot !== null && (
                    <span className="text-muted"> • {t('trace.nextSlot')}: {lastCapture.slot}</span>
                  )}
                  <span className="trace-last-capture-data">
                    {Object.entries(lastCapture.data)
                      .map(([k, v]) => `${tagName(Number(k.replace('tag_', '')))}: ${String(v)}`)
                      .join('  •  ')}
                  </span>
                </div>
              </div>
            )}

            {/* Ürün taraması — yalnız 'scan' modunda + trolley_read'siz istasyonlarda */}
            {shellSrc === 'scan' && !has('trolley_read') && (
              <>
                <Input
                  label={t('trace.productId')}
                  value={plcProduct}
                  onChange={(e) => setPlcProduct(e.target.value)}
                  placeholder={t('trace.scanProduct')}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && plcProduct.trim()) {
                      void doScan({ productId: plcProduct.trim() });
                      setPlcProduct('');
                    }
                  }}
                />
                <Button
                  onClick={() => {
                    void doScan({ productId: plcProduct.trim() });
                    setPlcProduct('');
                  }}
                  disabled={busy || !plcProduct.trim()}
                >
                  <ScanLine size={16} /> {t('trace.setActiveProduct')}
                </Button>
              </>
            )}
          </Card>
        )}

        {/* Parti Bağlama */}
        {has('batch_assign') && (
          <Card title={t('trace.cap.batch_assign')}>
            <Input
              label={t('trace.productId')}
              value={batchProduct}
              onChange={(e) => setBatchProduct(e.target.value)}
              placeholder={t('trace.scanProduct')}
            />
            <Input
              label={t('trace.batchNo')}
              value={batchNo}
              onChange={(e) => setBatchNo(e.target.value)}
              placeholder={t('trace.scanBatch')}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && batchProduct.trim() && batchNo.trim()) {
                  void doScan({ productId: batchProduct.trim(), batchNo: batchNo.trim() });
                }
              }}
            />
            <Button
              onClick={() => void doScan({ productId: batchProduct.trim(), batchNo: batchNo.trim() })}
              disabled={busy || !batchProduct.trim() || !batchNo.trim()}
            >
              {t('trace.submit')}
            </Button>
          </Card>
        )}

        {/* OK / NOK */}
        {has('ok_nok') && (
          <Card title={t('trace.cap.ok_nok')}>
            <Input
              label={t('trace.productId')}
              value={okNokProduct}
              onChange={(e) => setOkNokProduct(e.target.value)}
              placeholder={t('trace.scanProduct')}
            />
            <div className="flex gap-2" style={{ flexWrap: 'wrap' }}>
              <Button variant="secondary" onClick={() => void doScan({ productId: okNokProduct.trim(), status: 'ok' })} disabled={busy || !okNokProduct.trim()}>
                <CheckCircle2 size={16} /> OK
              </Button>
              <Button variant="danger" onClick={() => void doScan({ productId: okNokProduct.trim(), status: 'nok' })} disabled={busy || !okNokProduct.trim()}>
                <XCircle size={16} /> NOK
              </Button>
            </div>
          </Card>
        )}

        {/* Bekleme Kontrolü */}
        {has('wait_control') && (
          <Card title={t('trace.cap.wait_control')}>
            <Input
              label={t('trace.trolleyCode')}
              value={waitTrolley}
              onChange={(e) => setWaitTrolley(e.target.value)}
              placeholder={t('trace.scanTrolley')}
            />
            <div className="form-group">
              <span className="form-label">{t('trace.direction')}</span>
              <div className="flex gap-2">
                <Button variant={direction === 'entry' ? 'primary' : 'secondary'} onClick={() => setDirection('entry')}>
                  {t('trace.entry')}
                </Button>
                <Button variant={direction === 'exit' ? 'primary' : 'secondary'} onClick={() => setDirection('exit')}>
                  {t('trace.exit')}
                </Button>
              </div>
            </div>
            <Button onClick={() => void doScan({ trolleyCode: waitTrolley.trim(), direction })} disabled={busy || !waitTrolley.trim()}>
              {t('trace.submit')}
            </Button>
          </Card>
        )}
      </div>

      {/* ─── Önceki QR kodları ─── */}
      {has('qr_generate') && (
        <div className="mt-4">
          <Card title={t('trace.qrHistory')}>
            {history.length === 0 ? (
              <p className="text-muted">{t('trace.noQrHistory')}</p>
            ) : (
              <div className="trace-qr-history">
                {history.map((item) => (
                  <button
                    key={item.productId}
                    className="trace-qr-history-item"
                    onClick={() => openFromHistory(item)}
                    title={t('trace.reprint')}
                  >
                    <QrCode svgPath={item.svgPath} size={item.size} scale={2} />
                    <span className="trace-qr-history-id">{item.productId}</span>
                    {item.createdAt && (
                      <span className="trace-qr-history-date">
                        {new Date(item.createdAt + 'Z').toLocaleString()}
                      </span>
                    )}
                  </button>
                ))}
              </div>
            )}
          </Card>
        </div>
      )}

      {/* ─── QR etiket önizleme + yazdırma pop-up'ı ─── */}
      <QrLabelModal
        open={qrModalOpen}
        onClose={() => setQrModalOpen(false)}
        label={qrLabel}
        labelWidthMm={station.config.labelWidth}
        labelHeightMm={station.config.labelHeight}
      />
    </div>
  );
}
