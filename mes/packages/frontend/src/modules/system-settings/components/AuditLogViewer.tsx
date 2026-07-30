import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, Badge, Button, Table } from '../../../core/components/common';
import { auditService, type AuditEntry } from '../services/admin.service';

const PAGE_SIZE = 50;

const ACTION_VARIANT: Record<string, 'success' | 'danger' | 'warning' | 'info' | 'muted'> = {
  create: 'success',
  delete: 'danger',
  update: 'info',
  login: 'muted',
  start: 'success',
  stop: 'warning',
  pause: 'warning',
  resume: 'success',
  complete: 'info',
  archive: 'muted',
  trust_cert: 'success',
  enable: 'success',
  disable: 'warning',
};

export default function AuditLogViewer() {
  const { t } = useTranslation();
  const [entries, setEntries] = useState<AuditEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await auditService.list({ limit: PAGE_SIZE, offset });
      setEntries(data.entries);
      setTotal(data.total);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [offset]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div>
      <h1 style={{ fontSize: 'var(--font-size-2xl)', marginBottom: 'var(--space-5)' }}>
        {t('nav.audit')}
      </h1>

      {error && <Alert variant="danger" className="mb-4">{error}</Alert>}

      {loading && entries.length === 0 ? (
        <p className="text-muted">{t('common.loading')}</p>
      ) : entries.length === 0 ? (
        <p className="text-muted">{t('common.noData')}</p>
      ) : (
        <>
          <Table>
            <thead>
              <tr>
                <th>{t('audit.time')}</th>
                <th>{t('audit.user')}</th>
                <th>{t('audit.action')}</th>
                <th>{t('audit.entity')}</th>
                <th>{t('audit.details')}</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((e) => (
                <tr key={e.id}>
                  <td className="text-muted" style={{ fontSize: 'var(--font-size-xs)', whiteSpace: 'nowrap' }}>
                    {new Date(e.createdAt + 'Z').toLocaleString()}
                  </td>
                  <td>{e.username ?? '—'}</td>
                  <td>
                    <Badge variant={ACTION_VARIANT[e.action] ?? 'muted'}>{e.action}</Badge>
                  </td>
                  <td className="text-muted" style={{ fontSize: 'var(--font-size-sm)' }}>
                    {e.entityType ? `${e.entityType}${e.entityId ? ` #${e.entityId}` : ''}` : '—'}
                  </td>
                  <td className="text-muted" style={{ fontSize: 'var(--font-size-xs)', fontFamily: 'var(--font-mono)' }}>
                    {e.details ? JSON.stringify(e.details) : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </Table>

          <div className="flex items-center justify-between mt-4">
            <span className="text-muted" style={{ fontSize: 'var(--font-size-sm)' }}>
              {t('audit.total', { total })}
            </span>
            <div className="flex gap-2">
              <Button
                variant="secondary"
                small
                disabled={offset === 0 || loading}
                onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}
              >
                {t('audit.prev')}
              </Button>
              <Button
                variant="secondary"
                small
                disabled={offset + PAGE_SIZE >= total || loading}
                onClick={() => setOffset(offset + PAGE_SIZE)}
              >
                {t('audit.next')}
              </Button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
