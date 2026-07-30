import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { ArrowLeft, Printer, CheckCircle2, XCircle } from 'lucide-react';
import { Alert, Badge, Button, Card, Input, useToast } from '../../../core/components/common';
import { traceService, type QrLabel, type Station } from '../services/trace.service';
import QrCode from './QrCode';

/**
 * İstasyon çalışma ekranı — capability'lere göre dinamik UI.
 * Tarama (scan) odaklı: önce trolley/product QR tara → sistem doğrular → veri girişi → kaydet.
 */
export default function StationWorkPage() {
  const { t } = useTranslation();
  const toast = useToast();
  const { stationKey } = useParams<{ stationKey: string }>();

  const [station, setStation] = useState<Station | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Tarama alanları
  const [trolleyCode, setTrolleyCode] = useState('');
  const [productId, setProductId] = useState('');
  const [slotNumber, setSlotNumber] = useState<number | ''>('');
  const [batchNo, setBatchNo] = useState('');
  const [direction, setDirection] = useState<'entry' | 'exit'>('entry');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; message?: string; alarm?: boolean } | null>(null);
  const [qrLabel, setQrLabel] = useState<QrLabel | null>(null);

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

  const doScan = async (overrides: Partial<Parameters<typeof traceService.scan>[0]> = {}) => {
    if (!station) return;
    setBusy(true);
    setResult(null);
    try {
      const res = await traceService.scan({
        stationKey: station.key,
        ...(trolleyCode ? { trolleyCode: trolleyCode.trim() } : {}),
        ...(productId ? { productId: productId.trim() } : {}),
        ...(slotNumber ? { slotNumber: Number(slotNumber) } : {}),
        ...(batchNo ? { batchNo: batchNo.trim() } : {}),
        direction,
        ...overrides,
      });
      setResult({ ok: true, message: res.message, alarm: res.alarm });
      if (res.qrLabel) setQrLabel(res.qrLabel);
      if (res.productId && !productId) setProductId(res.productId);
      toast.success(res.message ?? t('common.success'));
    } catch (err) {
      const msg = err instanceof Error ? err.message : t('common.error');
      setResult({ ok: false, message: msg });
      toast.error(msg);
    } finally {
      setBusy(false);
    }
  };

  const handleOkNok = (status: 'ok' | 'nok') => {
    void doScan({ status });
  };

  const handlePrint = () => {
    window.print();
  };

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

      <div className="trace-work-grid">
        {/* ─── Tarama alanları ─── */}
        <Card title={t('trace.scan')}>
          {has('trolley_assign') || has('plc_acquire') || has('wait_control') ? (
            <Input
              label={t('trace.trolleyCode')}
              value={trolleyCode}
              onChange={(e) => setTrolleyCode(e.target.value)}
              placeholder={t('trace.scanTrolley')}
              autoFocus
            />
          ) : null}

          {!has('qr_generate') && (
            <Input
              label={t('trace.productId')}
              value={productId}
              onChange={(e) => setProductId(e.target.value)}
              placeholder={t('trace.scanProduct')}
              autoFocus={!has('trolley_assign') && !has('plc_acquire') && !has('wait_control')}
            />
          )}

          {has('trolley_assign') && (
            <Input
              label={t('trace.slotNumber')}
              type="number"
              min={1}
              max={20}
              value={slotNumber}
              onChange={(e) => setSlotNumber(e.target.value ? Number(e.target.value) : '')}
            />
          )}

          {has('batch_assign') && (
            <Input
              label={t('trace.batchNo')}
              value={batchNo}
              onChange={(e) => setBatchNo(e.target.value)}
              placeholder={t('trace.scanBatch')}
            />
          )}

          {has('wait_control') && (
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
          )}

          {/* ─── Aksiyonlar ─── */}
          <div className="flex gap-2" style={{ flexWrap: 'wrap', marginTop: 'var(--space-4)' }}>
            {has('qr_generate') && (
              <Button onClick={() => doScan()} disabled={busy}>
                <Printer size={16} /> {busy ? t('common.loading') : t('trace.generateQr')}
              </Button>
            )}
            {(has('trolley_assign') || has('plc_acquire') || has('batch_assign') || has('wait_control')) && (
              <Button onClick={() => doScan()} disabled={busy}>
                {busy ? t('common.loading') : t('trace.submit')}
              </Button>
            )}
            {has('ok_nok') && (
              <>
                <Button variant="secondary" onClick={() => handleOkNok('ok')} disabled={busy || !productId}>
                  <CheckCircle2 size={16} /> OK
                </Button>
                <Button variant="danger" onClick={() => handleOkNok('nok')} disabled={busy || !productId}>
                  <XCircle size={16} /> NOK
                </Button>
              </>
            )}
          </div>
        </Card>

        {/* ─── QR etiket ─── */}
        {qrLabel && (
          <Card title={t('trace.qrLabel')}>
            <div className="trace-qr-label">
              <QrCode svgPath={qrLabel.svgPath} size={qrLabel.size} scale={6} />
              <div className="trace-qr-text">{qrLabel.productId}</div>
            </div>
            <Button variant="secondary" onClick={handlePrint} className="mt-4">
              <Printer size={16} /> {t('trace.print')}
            </Button>
          </Card>
        )}
      </div>
    </div>
  );
}
