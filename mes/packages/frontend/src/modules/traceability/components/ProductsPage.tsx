import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Plus, Printer, Trash2 } from 'lucide-react';
import { Alert, Badge, Button, ConfirmDialog, Modal, Select, Table, useToast } from '../../../core/components/common';
import { traceService, type Measurement, type Product, type QrLabel, type StationRecord } from '../services/trace.service';
import QrLabelModal from './QrLabelModal';
import MeasurementEditor from './MeasurementEditor';

const STATUS_VARIANT: Record<Product['status'], 'info' | 'success' | 'danger'> = {
  in_progress: 'info',
  completed: 'success',
  rejected: 'danger',
};

export default function ProductsPage() {
  const { t } = useTranslation();
  const toast = useToast();
  const [products, setProducts] = useState<Product[]>([]);
  const [statusFilter, setStatusFilter] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [detail, setDetail] = useState<{ product: Product; records: StationRecord[]; measurements: Measurement[] } | null>(null);
  const [qrLabel, setQrLabel] = useState<QrLabel | null>(null);

  const [deleteTarget, setDeleteTarget] = useState<Product | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [creating, setCreating] = useState(false);

  const load = useCallback(async () => {
    try {
      const { products: p } = await traceService.listProducts(statusFilter ? { status: statusFilter } : undefined);
      setProducts(p);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [statusFilter]);

  useEffect(() => {
    void load();
  }, [load]);

  const openDetail = async (productId: string) => {
    try {
      const data = await traceService.getProduct(productId);
      setDetail(data);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('common.error'));
    }
  };

  const showQr = async (productId: string) => {
    try {
      const label = await traceService.getQrLabel(productId);
      setQrLabel(label);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('common.error'));
    }
  };

  const handleCreateProduct = async () => {
    setCreating(true);
    try {
      const { product, qrLabel: label } = await traceService.createProduct();
      toast.success(t('trace.productCreated', { id: product.product_id }));
      setQrLabel(label);
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('common.error'));
    } finally {
      setCreating(false);
    }
  };

  const handleDeleteProduct = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await traceService.deleteProduct(deleteTarget.id);
      toast.success(t('trace.productDeleted', { id: deleteTarget.product_id }));
      setDeleteTarget(null);
      void load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('common.error'));
    } finally {
      setDeleting(false);
    }
  };

  // Detay pop-up'ındaki ölçümleri istasyon bazında grupla
  const measurementsByStation = (detail?.measurements ?? []).reduce<Record<string, Measurement[]>>((acc, m) => {
    (acc[m.stationKey] ??= []).push(m);
    return acc;
  }, {});

  return (
    <div>
      <div className="flex items-center justify-between mb-4" style={{ flexWrap: 'wrap', gap: 'var(--space-3)' }}>
        <h1 style={{ fontSize: 'var(--font-size-2xl)' }}>{t('trace.products')}</h1>
        <div className="flex items-center gap-2" style={{ flexWrap: 'wrap' }}>
          <div style={{ minWidth: 180 }}>
            <Select aria-label={t('common.status')} value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
              <option value="">{t('workOrder.allStatuses')}</option>
              <option value="in_progress">{t('trace.status.in_progress')}</option>
              <option value="completed">{t('trace.status.completed')}</option>
              <option value="rejected">{t('trace.status.rejected')}</option>
            </Select>
          </div>
          <Button onClick={() => void handleCreateProduct()} disabled={creating}>
            <Plus size={16} /> {t('trace.addProduct')}
          </Button>
        </div>
      </div>

      {error && <Alert variant="danger" className="mb-4">{error}</Alert>}

      {loading ? (
        <p className="text-muted">{t('common.loading')}</p>
      ) : products.length === 0 ? (
        <p className="text-muted">{t('trace.noProducts')}</p>
      ) : (
        <Table>
          <thead>
            <tr>
              <th>{t('trace.productId')}</th>
              <th>{t('common.status')}</th>
              <th>{t('trace.trolley')}</th>
              <th>{t('trace.slotNo')}</th>
              <th>{t('common.createdAt')}</th>
              <th style={{ width: 120 }}>{t('common.actions')}</th>
            </tr>
          </thead>
          <tbody>
            {products.map((p) => (
              <tr key={p.id}>
                <td>
                  <button className="trace-link" onClick={() => openDetail(p.product_id)}>
                    {p.product_id}
                  </button>
                </td>
                <td>
                  <Badge variant={STATUS_VARIANT[p.status]}>{t(`trace.status.${p.status}`)}</Badge>
                </td>
                <td className="text-muted">{p.trolley_code ?? '—'}</td>
                <td className="text-muted">{p.slot_number ?? '—'}</td>
                <td className="text-muted" style={{ fontSize: 'var(--font-size-sm)' }}>
                  {new Date(p.created_at + 'Z').toLocaleString()}
                </td>
                <td>
                  <div className="flex gap-1">
                    <button className="btn-icon" title={t('trace.print')} onClick={() => showQr(p.product_id)}>
                      <Printer size={16} />
                    </button>
                    <button className="btn-icon text-danger" title={t('trace.deleteProduct')} onClick={() => setDeleteTarget(p)}>
                      <Trash2 size={16} />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}

      {/* ─── Ürün detayı ─── */}
      <Modal open={detail !== null} wide title={detail?.product.product_id ?? ''} onClose={() => setDetail(null)}>
        {detail && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-5)' }}>
            <div className="flex gap-2" style={{ flexWrap: 'wrap' }}>
              <Badge variant={STATUS_VARIANT[detail.product.status]}>
                {t(`trace.status.${detail.product.status}`)}
              </Badge>
              {detail.product.trolley_code && (
                <Badge variant="info">
                  {detail.product.trolley_code}
                  {detail.product.slot_number ? ` #${detail.product.slot_number}` : ''}
                </Badge>
              )}
            </div>

            {/* Ölçümler — istasyon bazında, düzenlenebilir */}
            <div>
              <div style={{ fontWeight: 600, fontSize: 'var(--font-size-sm)', marginBottom: 'var(--space-3)' }}>
                📊 {t('trace.measurements')}
              </div>
              {Object.keys(measurementsByStation).length === 0 ? (
                <p className="text-muted" style={{ fontSize: 'var(--font-size-xs)' }}>{t('trace.noMeasurements')}</p>
              ) : (
                Object.entries(measurementsByStation).map(([stationKey, items]) => (
                  <div key={stationKey} style={{ marginBottom: 'var(--space-4)' }}>
                    <div className="text-muted" style={{ fontSize: 'var(--font-size-xs)', marginBottom: 4, fontFamily: 'var(--font-mono)' }}>
                      {stationKey}
                    </div>
                    <MeasurementEditor
                      shellId={detail.product.product_id}
                      stationKey={stationKey}
                      onChanged={() => void openDetail(detail.product.product_id)}
                    />
                  </div>
                ))
              )}
            </div>

            {/* İstasyon geçmişi (olay günlüğü) */}
            <div>
              <div style={{ fontWeight: 600, fontSize: 'var(--font-size-sm)', marginBottom: 'var(--space-3)' }}>
                📜 {t('trace.stationHistoryTitle')}
              </div>
              {detail.records.length === 0 ? (
                <p className="text-muted" style={{ fontSize: 'var(--font-size-xs)' }}>{t('trace.noRecords')}</p>
              ) : (
                <Table>
                  <thead>
                    <tr>
                      <th>{t('trace.station')}</th>
                      <th>{t('common.status')}</th>
                      <th>{t('audit.time')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {detail.records.map((r, idx) => (
                      <tr key={r.id ?? idx}>
                        <td>{r.station_name}</td>
                        <td>
                          {r.status ? (
                            <Badge variant={r.status === 'ok' || r.status === 'done' ? 'success' : r.status === 'nok' ? 'danger' : 'muted'}>
                              {r.status}
                            </Badge>
                          ) : '—'}
                        </td>
                        <td className="text-muted" style={{ fontSize: 'var(--font-size-xs)' }}>
                          {new Date((r.created_at ?? '') + 'Z').toLocaleString()}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </Table>
              )}
            </div>
          </div>
        )}
      </Modal>

      {/* ─── QR etiket önizleme + yazdırma ─── */}
      <QrLabelModal open={qrLabel !== null} label={qrLabel} onClose={() => setQrLabel(null)} />

      {/* ─── Ürün silme onay diyaloğu ─── */}
      <ConfirmDialog
        open={deleteTarget !== null}
        title={t('trace.deleteProduct')}
        message={deleteTarget ? t('trace.deleteProductConfirm', { id: deleteTarget.product_id }) : ''}
        confirmLabel={t('common.delete')}
        danger
        busy={deleting}
        onConfirm={() => void handleDeleteProduct()}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  );
}
