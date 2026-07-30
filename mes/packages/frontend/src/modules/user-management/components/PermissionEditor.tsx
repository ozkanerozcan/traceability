import { Fragment, useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, Card, Checkbox, useToast } from '../../../core/components/common';
import { permissionService, type PermissionEntry } from '../../system-settings/services/admin.service';
import '../../system-settings/styles/settings.css';

const ROLE = 'operator';
const MODULE_LABEL_KEYS: Record<string, string> = {
  'plc-gateway': 'nav.plc',
  recipe: 'nav.recipes',
  'work-order': 'nav.workOrders',
  dashboard: 'nav.dashboard',
  'user-management': 'nav.users',
  'system-settings': 'nav.settings',
};

/** Operatör rolü için modül × yetki matrisi (admin). */
export default function PermissionEditor() {
  const { t } = useTranslation();
  const toast = useToast();
  const [permissions, setPermissions] = useState<PermissionEntry[]>([]);
  const [modules, setModules] = useState<string[]>([]);
  const [types, setTypes] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyKey, setBusyKey] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const data = await permissionService.list();
      setPermissions(data.permissions);
      setModules(data.modules);
      setTypes(data.permissionTypes);
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

  const isGranted = (moduleId: string, permission: string) =>
    permissions.some(
      (p) => p.role === ROLE && p.moduleId === moduleId && p.permission === permission && p.granted
    );

  const toggle = async (moduleId: string, permission: string, granted: boolean) => {
    const key = `${moduleId}:${permission}`;
    setBusyKey(key);
    try {
      await permissionService.set({ role: ROLE, moduleId, permission, granted });
      setPermissions((prev) => {
        const idx = prev.findIndex(
          (p) => p.role === ROLE && p.moduleId === moduleId && p.permission === permission
        );
        if (idx >= 0) {
          const next = [...prev];
          next[idx] = { ...next[idx], granted };
          return next;
        }
        return [...prev, { role: ROLE, moduleId, permission, granted }];
      });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('common.error'));
    } finally {
      setBusyKey(null);
    }
  };

  if (loading) return null;

  return (
    <Card title={t('users.permissions')}>
      <p className="text-muted" style={{ fontSize: 'var(--font-size-sm)', marginBottom: 'var(--space-4)' }}>
        {t('users.permissionsHint')}
      </p>
      {error && <Alert variant="danger" className="mb-4">{error}</Alert>}
      <div className="perm-grid">
        <div className="perm-grid-head" />
        {types.map((type) => (
          <div key={type} className="perm-grid-head perm-grid-col">
            {t(`users.perm.${type}`)}
          </div>
        ))}
        {modules.map((moduleId) => (
          <Fragment key={moduleId}>
            <div className="perm-grid-module">{t(MODULE_LABEL_KEYS[moduleId] ?? moduleId)}</div>
            {types.map((type) => (
              <div key={`${moduleId}-${type}`} className="perm-grid-col">
                <Checkbox
                  aria-label={`${moduleId} ${type}`}
                  checked={isGranted(moduleId, type)}
                  disabled={busyKey === `${moduleId}:${type}`}
                  onChange={(e) => toggle(moduleId, type, e.target.checked)}
                />
              </div>
            ))}
          </Fragment>
        ))}
      </div>
    </Card>
  );
}
