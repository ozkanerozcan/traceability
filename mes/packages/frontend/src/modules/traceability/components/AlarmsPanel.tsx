import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { CheckCheck } from 'lucide-react';
import { Alert, Badge, Button, Table, useToast } from '../../../core/components/common';
import { traceService, type Alarm } from '../services/trace.service';

const SEVERITY_VARIANT: Record<Alarm['severity'], 'info' | 'warning' | 'danger'> = {
  info: 'info',
  warning: 'warning',
  critical: 'danger',
};

export default function AlarmsPanel() {
  const { t } = useTranslation();
  const toast = useToast();
  const [alarms, setAlarms] = useState<Alarm[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<number | null>(null);

  const load = useCallback(async () => {
    try {
      const { alarms: a } = await traceService.listAlarms({ activeOnly: true });
      setAlarms(a);
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

  const ack = async (id: number) => {
    setBusyId(id);
    try {
      await traceService.ackAlarm(id);
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
      <h1 style={{ fontSize: 'var(--font-size-2xl)', marginBottom: 'var(--space-5)' }}>
        {t('trace.alarms')}
      </h1>

      {error && <Alert variant="danger" className="mb-4">{error}</Alert>}

      {loading ? (
        <p className="text-muted">{t('common.loading')}</p>
      ) : alarms.length === 0 ? (
        <Alert variant="success">{t('trace.noAlarms')}</Alert>
      ) : (
        <Table>
          <thead>
            <tr>
              <th>{t('audit.time')}</th>
              <th>{t('trace.severity')}</th>
              <th>{t('trace.message')}</th>
              <th>{t('trace.productId')}</th>
              <th style={{ width: 120 }}>{t('common.actions')}</th>
            </tr>
          </thead>
          <tbody>
            {alarms.map((a) => (
              <tr key={a.id}>
                <td className="text-muted" style={{ fontSize: 'var(--font-size-xs)', whiteSpace: 'nowrap' }}>
                  {new Date(a.created_at + 'Z').toLocaleString()}
                </td>
                <td>
                  <Badge variant={SEVERITY_VARIANT[a.severity]}>{t(`trace.sev.${a.severity}`)}</Badge>
                </td>
                <td>{a.message}</td>
                <td className="text-muted" style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--font-size-sm)' }}>
                  {a.product_id ?? '—'}
                </td>
                <td>
                  <Button variant="secondary" small onClick={() => ack(a.id)} disabled={busyId === a.id}>
                    <CheckCheck size={14} /> {t('trace.ack')}
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
    </div>
  );
}
