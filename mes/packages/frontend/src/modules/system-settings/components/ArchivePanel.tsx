import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Archive } from 'lucide-react';
import { Alert, Button, Card, ConfirmDialog, useToast } from '../../../core/components/common';
import { archiveService, type ArchiveStatus } from '../services/admin.service';

/** DB arşivleme kartı: boyut göstergesi + interlock + tetikleme. */
export default function ArchivePanel() {
  const { t } = useTranslation();
  const toast = useToast();
  const [status, setStatus] = useState<ArchiveStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const data = await archiveService.status();
      setStatus(data);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const handleArchive = async () => {
    setBusy(true);
    try {
      const res = await archiveService.run();
      setConfirmOpen(false);
      toast.success(t('settings.archiveDone', { count: res.deletedRows }));
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('common.error'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card title={t('settings.archive')}>
      {error && <Alert variant="danger" className="mb-4">{error}</Alert>}
      {status && (
        <>
          <div className="archive-size">{status.sizeMb} MB</div>
          <p className="text-muted" style={{ fontSize: 'var(--font-size-sm)', marginBottom: 'var(--space-4)' }}>
            {t('settings.archiveSizeHint', { warn: Math.round(status.warnBytes / (1024 * 1024 * 1024) * 10) / 10 })}
          </p>

          {status.warnExceeded && (
            <Alert variant="warning" className="mb-4">{t('settings.archiveWarn')}</Alert>
          )}
          {!status.canArchive && (
            <Alert variant="warning" className="mb-4">
              {t('settings.archiveBlocked', { count: status.activeWorkOrders })}
            </Alert>
          )}

          <Button variant="secondary" onClick={() => setConfirmOpen(true)} disabled={!status.canArchive || busy}>
            <Archive size={16} /> {t('settings.archiveNow')}
          </Button>

          <ConfirmDialog
            open={confirmOpen}
            title={t('settings.archive')}
            message={t('settings.archiveConfirm')}
            confirmLabel={t('settings.archiveNow')}
            danger={false}
            busy={busy}
            onConfirm={handleArchive}
            onCancel={() => setConfirmOpen(false)}
          />
        </>
      )}
    </Card>
  );
}
