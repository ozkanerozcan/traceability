import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { ArrowLeft } from 'lucide-react';
import { Alert, Badge, Table } from '../../../core/components/common';
import { plcService, tagService, type PlcProfile, type PlcTag } from '../services/plc.service';
import { formatLiveValue, usePlcLiveData, usePlcStatusUpdates } from '../hooks/usePlcLiveData';

/**
 * Canlı Monitör: aktif iş emri olmadan da makine durumunu izlemek için
 * PLC'nin tüm tag'lerinin gerçek zamanlı değerlerini gösterir (salt okunur).
 */
export default function LiveMonitor() {
  const { t } = useTranslation();
  const { id } = useParams<{ id: string }>();
  const plcId = Number(id);

  const [plc, setPlc] = useState<PlcProfile | null>(null);
  const [tags, setTags] = useState<PlcTag[]>([]);
  const [loading, setLoading] = useState(true);
  const [workerStatus, setWorkerStatus] = useState<string>('stopped');

  const liveValues = usePlcLiveData(plcId);

  useEffect(() => {
    void Promise.all([plcService.get(plcId), tagService.list(plcId)]).then(([plcData, tagData]) => {
      setPlc(plcData.plc);
      setWorkerStatus(plcData.plc.workerStatus ?? 'stopped');
      setTags(tagData.tags.filter((tag) => tag.isActive));
      setLoading(false);
    });
  }, [plcId]);

  usePlcStatusUpdates((updatedPlcId, status) => {
    if (updatedPlcId === plcId) setWorkerStatus(status);
  });

  if (loading) {
    return <p className="text-muted">{t('common.loading')}</p>;
  }

  return (
    <div>
      <div className="flex items-center gap-3 mb-4">
        <Link to="/plc" className="btn-icon">
          <ArrowLeft size={18} />
        </Link>
        <h1 style={{ fontSize: 'var(--font-size-2xl)' }}>{plc?.name} — {t('plc.liveMonitor')}</h1>
        <Badge
          variant={
            workerStatus === 'online'
              ? 'success'
              : workerStatus === 'connecting' || workerStatus === 'cert_pending'
                ? 'warning'
                : 'danger'
          }
        >
          {workerStatus === 'online'
            ? t('plc.statusOnline')
            : workerStatus === 'connecting'
              ? t('plc.statusConnecting')
              : workerStatus === 'cert_pending'
                ? t('plc.statusCertPending')
                : t('plc.statusOffline')}
        </Badge>
      </div>

      {workerStatus !== 'online' && (
        <Alert variant="warning" className="mb-4">
          {t('plc.monitorOfflineHint')}
        </Alert>
      )}

      {tags.length === 0 ? (
        <p className="text-muted">{t('plc.noTags')}</p>
      ) : (
        <Table>
          <thead>
            <tr>
              <th>{t('common.name')}</th>
              <th>{t('plc.address')}</th>
              <th>{t('plc.dataType')}</th>
              <th>{t('plc.liveValue')}</th>
              <th>{t('plc.lastUpdate')}</th>
            </tr>
          </thead>
          <tbody>
            {tags.map((tag) => {
              const live = liveValues.get(tag.id);
              return (
                <tr key={tag.id}>
                  <td style={{ fontWeight: 600 }}>{tag.name}</td>
                  <td style={{ fontFamily: 'var(--font-mono)' }}>{tag.address}</td>
                  <td>{tag.dataType}</td>
                  <td style={{ fontFamily: 'var(--font-mono)', fontWeight: 700, fontSize: 'var(--font-size-lg)' }}>
                    {formatLiveValue(live?.value, tag.unit)}
                  </td>
                  <td className="text-muted" style={{ fontSize: 'var(--font-size-xs)' }}>
                    {live ? new Date(live.timestamp).toLocaleTimeString() : '—'}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </Table>
      )}
    </div>
  );
}