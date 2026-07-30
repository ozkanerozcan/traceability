import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  Plus,
  Pencil,
  Trash2,
  Play,
  Square,
  Tags,
  Activity,
  ClipboardEdit,
  ShieldCheck,
} from 'lucide-react';
import { Badge, Button, ConfirmDialog, Table, useToast } from '../../../core/components/common';


import { plcService, type PlcProfile } from '../services/plc.service';
import { usePlcStatusUpdates } from '../hooks/usePlcLiveData';
import PlcForm from './PlcForm';
import CertificatesPanel from './CertificatesPanel';

function StatusBadge({ status }: { status?: string }) {
  const { t } = useTranslation();
  switch (status) {
    case 'online':
      return <Badge variant="success">{t('plc.statusOnline')}</Badge>;
    case 'offline':
      return <Badge variant="danger">{t('plc.statusOffline')}</Badge>;
    case 'connecting':
      return <Badge variant="warning">{t('plc.statusConnecting')}</Badge>;
    case 'cert_pending':
      return <Badge variant="warning">{t('plc.statusCertPending')}</Badge>;
    default:
      return <Badge variant="muted">{t('plc.statusStopped')}</Badge>;
  }
}

function protocolLabel(protocol: PlcProfile['protocol']): string {
  switch (protocol) {
    case 'modbus_tcp':
      return 'Modbus TCP';
    case 'modbus_rtu':
      return 'Modbus RTU';
    case 'opcua':
      return 'OPC UA';
  }
}

export default function PlcList() {
  const { t } = useTranslation();
  const toast = useToast();
  const [plcs, setPlcs] = useState<PlcProfile[]>([]);



  const [loading, setLoading] = useState(true);
  const [formOpen, setFormOpen] = useState(false);
  const [editingPlc, setEditingPlc] = useState<PlcProfile | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<PlcProfile | null>(null);
  const [certsPlc, setCertsPlc] = useState<PlcProfile | null>(null);
  const [busyId, setBusyId] = useState<number | null>(null);

  const load = useCallback(async () => {
    try {
      const data = await plcService.list();
      setPlcs(data.plcs);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // WebSocket: PLC durum değişikliklerini canlı yansıt
  usePlcStatusUpdates((plcId, status, message) => {
    setPlcs((prev) =>
      prev.map((p) =>
        p.id === plcId ? { ...p, workerStatus: status, workerStatusMessage: message } : p
      )
    );
  });

  const handleStartStop = async (plc: PlcProfile) => {
    setBusyId(plc.id);
    try {
      if (plc.workerStatus === 'online' || plc.workerStatus === 'connecting' || plc.workerStatus === 'offline' && plc.isActive) {
        await plcService.stop(plc.id);
      } else {
        await plcService.start(plc.id);
      }
      await load();
    } finally {
      setBusyId(null);
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    setBusyId(deleteTarget.id);
    try {
      await plcService.remove(deleteTarget.id);
      setDeleteTarget(null);
      toast.success(t('common.success'));
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('common.error'));
    } finally {
      setBusyId(null);
    }
  };


  const connectionInfo = (plc: PlcProfile): string => {
    if (plc.protocol === 'modbus_tcp') {
      return `${plc.host}:${plc.port} (ID ${plc.unitId})`;
    }
    if (plc.protocol === 'opcua') {
      const sec = plc.securityMode !== 'None' ? ` [${plc.securityMode}]` : '';
      return `${plc.endpointUrl ?? '—'}${sec}`;
    }
    return `${plc.serialPort} @${plc.baudRate} (ID ${plc.unitId})`;
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-4" style={{ flexWrap: 'wrap', gap: 'var(--space-3)' }}>
        <h1 style={{ fontSize: 'var(--font-size-2xl)' }}>{t('nav.plc')}</h1>
        <div className="flex gap-2 page-header-actions">

          <Link to="/plc/read-write">
            <Button variant="secondary">
              <ClipboardEdit size={16} /> {t('plc.readWrite')}
            </Button>
          </Link>
          <Button onClick={() => { setEditingPlc(null); setFormOpen(true); }}>
            <Plus size={16} /> {t('plc.addPlc')}
          </Button>
        </div>
      </div>

      {loading ? (
        <p className="text-muted">{t('common.loading')}</p>
      ) : plcs.length === 0 ? (
        <p className="text-muted">{t('plc.noPlcs')}</p>
      ) : (
        <Table>
          <thead>
            <tr>
              <th>{t('common.name')}</th>
              <th>{t('plc.protocol')}</th>
              <th>{t('plc.connection')}</th>
              <th>{t('common.status')}</th>
              <th>{t('common.active')}</th>
              <th style={{ width: 280 }}>{t('common.actions')}</th>
            </tr>
          </thead>
          <tbody>
            {plcs.map((plc) => (
              <tr key={plc.id}>
                <td>
                  <div style={{ fontWeight: 600 }}>{plc.name}</div>
                  {plc.description && <div className="text-muted" style={{ fontSize: 'var(--font-size-xs)' }}>{plc.description}</div>}
                </td>
                <td>{protocolLabel(plc.protocol)}</td>
                <td style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--font-size-sm)' }}>
                  {connectionInfo(plc)}
                </td>
                <td>
                  <StatusBadge status={plc.workerStatus} />
                  {plc.workerStatusMessage && (
                    <div className="text-muted" style={{ fontSize: 'var(--font-size-xs)', marginTop: 2 }}>
                      {plc.workerStatusMessage}
                    </div>
                  )}
                </td>
                <td>
                  {plc.isActive ? (
                    <Badge variant="info">{t('common.yes')}</Badge>
                  ) : (
                    <Badge variant="muted">{t('common.no')}</Badge>
                  )}
                </td>
                <td>
                  <div className="flex gap-1">
                    <button
                      className="btn-icon"
                      title={plc.workerStatus === 'online' || plc.isActive ? t('plc.stop') : t('plc.start')}
                      disabled={busyId === plc.id}
                      onClick={() => handleStartStop(plc)}
                    >
                      {plc.workerStatus === 'online' || plc.isActive ? <Square size={16} /> : <Play size={16} />}
                    </button>
                    <Link to={`/plc/${plc.id}/tags`} className="btn-icon" title={t('plc.tags')}>
                      <Tags size={16} />
                    </Link>
                    <Link to={`/plc/${plc.id}/monitor`} className="btn-icon" title={t('plc.liveMonitor')}>
                      <Activity size={16} />
                    </Link>
                    {plc.protocol === 'opcua' && (
                      <button
                        className="btn-icon"
                        title={t('plc.certificates')}
                        onClick={() => setCertsPlc(plc)}
                      >
                        <ShieldCheck size={16} />
                      </button>
                    )}
                    <button
                      className="btn-icon"
                      title={t('common.edit')}
                      onClick={() => { setEditingPlc(plc); setFormOpen(true); }}
                    >
                      <Pencil size={16} />
                    </button>
                    <button
                      className="btn-icon"
                      title={t('common.delete')}
                      onClick={() => setDeleteTarget(plc)}
                    >
                      <Trash2 size={16} />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}

      <PlcForm
        open={formOpen}
        onClose={() => setFormOpen(false)}
        onSaved={load}
        plc={editingPlc}
      />

      <CertificatesPanel
        open={certsPlc !== null}
        onClose={() => setCertsPlc(null)}
        plc={certsPlc}
        onChanged={load}
      />

      <ConfirmDialog
        open={deleteTarget !== null}
        title={t('plc.deletePlc')}
        message={t('plc.deleteConfirm', { name: deleteTarget?.name })}
        busy={busyId !== null}
        onConfirm={handleDelete}
        onCancel={() => setDeleteTarget(null)}
      />

    </div>
  );
}