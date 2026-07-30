import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ShieldCheck, ShieldX, Download } from 'lucide-react';
import { Alert, Badge, Button, Modal, Table, useToast } from '../../../core/components/common';

import { opcuaService, type PlcProfile, type ServerCert } from '../services/plc.service';

interface CertificatesPanelProps {
  open: boolean;
  onClose: () => void;
  plc: PlcProfile | null;
  /** Trust/reject sonrası PLC listesini tazelemek için */
  onChanged?: () => void;
}

function CertStatusBadge({ status }: { status: ServerCert['status'] }) {
  const { t } = useTranslation();
  switch (status) {
    case 'trusted':
      return <Badge variant="success">{t('plc.certTrusted')}</Badge>;
    case 'rejected':
      return <Badge variant="danger">{t('plc.certRejected')}</Badge>;
    default:
      return <Badge variant="warning">{t('plc.certPending')}</Badge>;
  }
}

/**
 * OPC UA sunucu sertifikası güven yönetimi paneli (TOFU).
 * Bekleyen sertifikaları onaylama/reddetme + istemci sertifikasını indirme.
 */
export default function CertificatesPanel({ open, onClose, plc, onChanged }: CertificatesPanelProps) {
  const { t } = useTranslation();
  const toast = useToast();
  const [certs, setCerts] = useState<ServerCert[]>([]);

  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!plc) return;
    setLoading(true);
    setError(null);
    try {
      const { certs } = await opcuaService.listCerts(plc.id);
      setCerts(certs);
    } catch (err) {
      setError(err instanceof Error ? err.message : t('common.error'));
    } finally {
      setLoading(false);
    }
  }, [plc, t]);

  useEffect(() => {
    if (open) void load();
  }, [open, load]);

  const handleDecision = async (cert: ServerCert, decision: 'trust' | 'reject') => {
    if (!plc) return;
    setBusy(cert.thumbprint);
    setError(null);
    try {
      if (decision === 'trust') {
        await opcuaService.trustCert(plc.id, cert.thumbprint);
      } else {
        await opcuaService.rejectCert(plc.id, cert.thumbprint);
      }
      toast.success(decision === 'trust' ? t('plc.certTrusted') : t('plc.certRejected'));
      await load();
      onChanged?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : t('common.error'));
    } finally {
      setBusy(null);
    }
  };


  const handleDownloadClientCert = async () => {
    if (!plc) return;
    try {
      const { pem } = await opcuaService.clientCert(plc.id);
      const blob = new Blob([pem], { type: 'application/x-pem-file' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'oe-mes-client-cert.pem';
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      setError(err instanceof Error ? err.message : t('common.error'));
    }
  };

  return (
    <Modal
      open={open}
      wide
      title={`${t('plc.certificates')} — ${plc?.name ?? ''}`}

      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={handleDownloadClientCert}>
            <Download size={16} /> {t('plc.downloadClientCert')}
          </Button>
          <div className="spacer" />
          <Button variant="ghost" onClick={onClose}>
            {t('common.close')}
          </Button>
        </>
      }
    >
      <p className="text-muted" style={{ fontSize: 'var(--font-size-sm)', marginBottom: 'var(--space-4)' }}>
        {t('plc.certPanelHint')}
      </p>

      {error && (
        <Alert variant="danger" className="mb-4">
          {error}
        </Alert>
      )}

      {loading ? (
        <p className="text-muted">{t('common.loading')}</p>
      ) : certs.length === 0 ? (
        <p className="text-muted">{t('plc.noCerts')}</p>
      ) : (
        <Table>
          <thead>
            <tr>
              <th>{t('plc.subject')}</th>
              <th>{t('plc.thumbprint')}</th>
              <th>{t('common.status')}</th>
              <th style={{ width: 180 }}>{t('common.actions')}</th>
            </tr>
          </thead>
          <tbody>
            {certs.map((cert) => (
              <tr key={cert.thumbprint}>
                <td style={{ fontSize: 'var(--font-size-sm)' }}>{cert.subject ?? '—'}</td>
                <td style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--font-size-xs)' }}>
                  {cert.thumbprint}
                </td>
                <td>
                  <CertStatusBadge status={cert.status} />
                </td>
                <td>
                  <div className="flex gap-1">
                    {cert.status !== 'trusted' && (
                      <Button
                        variant="secondary"
                        small
                        disabled={busy === cert.thumbprint}
                        onClick={() => handleDecision(cert, 'trust')}
                      >
                        <ShieldCheck size={14} /> {t('plc.trust')}
                      </Button>
                    )}
                    {cert.status !== 'rejected' && (
                      <Button
                        variant="ghost"
                        small
                        disabled={busy === cert.thumbprint}
                        onClick={() => handleDecision(cert, 'reject')}
                      >
                        <ShieldX size={14} /> {t('plc.reject')}
                      </Button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
    </Modal>
  );
}
