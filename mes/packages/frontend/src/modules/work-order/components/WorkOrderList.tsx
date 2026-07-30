import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  Plus,
  Play,
  Pause,
  CheckCircle2,
  Archive,
  Trash2,
  LayoutDashboard,
} from 'lucide-react';
import { Alert, Badge, Button, ConfirmDialog, Select, Table, useToast } from '../../../core/components/common';
import { workOrderService, WO_STATUS_VARIANT, type WorkOrder, type WorkOrderStatus } from '../services/workOrder.service';
import { recipeService, type Recipe } from '../../recipe/services/recipe.service';
import WorkOrderForm from './WorkOrderForm';
import { useWsMessage } from '../../../core/hooks/useWebSocket';

const ALL_STATUSES: WorkOrderStatus[] = ['draft', 'active', 'paused', 'completed', 'archived'];

export default function WorkOrderList() {
  const { t } = useTranslation();
  const toast = useToast();
  const [workOrders, setWorkOrders] = useState<WorkOrder[]>([]);
  const [recipes, setRecipes] = useState<Recipe[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<string>('');
  const [formOpen, setFormOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<WorkOrder | null>(null);
  const [busyId, setBusyId] = useState<number | null>(null);

  const recipeName = useCallback(
    (id: number) => recipes.find((r) => r.id === id)?.name ?? `#${id}`,
    [recipes]
  );

  const load = useCallback(async () => {
    try {
      const [woData, recipeData] = await Promise.all([
        workOrderService.list(statusFilter ? { status: statusFilter as WorkOrderStatus } : undefined),
        recipeService.list(),
      ]);
      setWorkOrders(woData.workOrders);
      setRecipes(recipeData.recipes);
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

  // WS: başka bir kullanıcı iş emri durumunu değiştirdiğinde listeyi tazele
  useWsMessage('workorder:changed', useCallback(() => {
    void load();
  }, [load]));

  const doAction = async (wo: WorkOrder, action: 'activate' | 'pause' | 'resume' | 'complete' | 'archive') => {
    setBusyId(wo.id);
    try {
      await workOrderService[action](wo.id);
      toast.success(t('common.success'));
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('common.error'));
    } finally {
      setBusyId(null);
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    setBusyId(deleteTarget.id);
    try {
      await workOrderService.remove(deleteTarget.id);
      setDeleteTarget(null);
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
      <div className="flex items-center justify-between mb-4" style={{ flexWrap: 'wrap', gap: 'var(--space-3)' }}>
        <h1 style={{ fontSize: 'var(--font-size-2xl)' }}>{t('nav.workOrders')}</h1>
        <div className="flex gap-2 page-header-actions">
          <div style={{ minWidth: 180 }}>
            <Select
              aria-label={t('common.status')}
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
            >
              <option value="">{t('workOrder.allStatuses')}</option>
              {ALL_STATUSES.map((s) => (
                <option key={s} value={s}>{t(`workOrder.status.${s}`)}</option>
              ))}
            </Select>
          </div>
          <Button onClick={() => setFormOpen(true)}>
            <Plus size={16} /> {t('workOrder.add')}
          </Button>
        </div>
      </div>

      {error && (
        <Alert variant="danger" className="mb-4">{error}</Alert>
      )}

      {loading ? (
        <p className="text-muted">{t('common.loading')}</p>
      ) : workOrders.length === 0 ? (
        <p className="text-muted">{t('workOrder.noWorkOrders')}</p>
      ) : (
        <Table>
          <thead>
            <tr>
              <th>{t('workOrder.orderNumber')}</th>
              <th>{t('workOrder.recipe')}</th>
              <th>{t('common.status')}</th>
              <th>{t('common.createdAt')}</th>
              <th>{t('workOrder.startedAt')}</th>
              <th style={{ width: 220 }}>{t('common.actions')}</th>
            </tr>
          </thead>
          <tbody>
            {workOrders.map((wo) => (
              <tr key={wo.id}>
                <td>
                  <div style={{ fontWeight: 600, fontFamily: 'var(--font-mono)' }}>{wo.orderNumber}</div>
                  {wo.notes && (
                    <div className="text-muted" style={{ fontSize: 'var(--font-size-xs)' }}>{wo.notes}</div>
                  )}
                </td>
                <td>{recipeName(wo.recipeId)}</td>
                <td>
                  <Badge variant={WO_STATUS_VARIANT[wo.status]}>
                    {t(`workOrder.status.${wo.status}`)}
                  </Badge>
                </td>
                <td className="text-muted" style={{ fontSize: 'var(--font-size-sm)' }}>
                  {new Date(wo.createdAt + 'Z').toLocaleString()}
                </td>
                <td className="text-muted" style={{ fontSize: 'var(--font-size-sm)' }}>
                  {wo.startedAt ? new Date(wo.startedAt + 'Z').toLocaleString() : '—'}
                </td>
                <td>
                  <div className="flex gap-1">
                    {(wo.status === 'active' || wo.status === 'paused') && (
                      <Link to={`/dashboard/${wo.id}`} className="btn-icon" title={t('nav.dashboard')}>
                        <LayoutDashboard size={16} />
                      </Link>
                    )}
                    {wo.status === 'draft' && (
                      <button className="btn-icon" title={t('workOrder.start')} disabled={busyId === wo.id} onClick={() => doAction(wo, 'activate')}>
                        <Play size={16} />
                      </button>
                    )}
                    {wo.status === 'active' && (
                      <>
                        <button className="btn-icon" title={t('workOrder.pause')} disabled={busyId === wo.id} onClick={() => doAction(wo, 'pause')}>
                          <Pause size={16} />
                        </button>
                        <button className="btn-icon" title={t('workOrder.complete')} disabled={busyId === wo.id} onClick={() => doAction(wo, 'complete')}>
                          <CheckCircle2 size={16} />
                        </button>
                      </>
                    )}
                    {wo.status === 'paused' && (
                      <>
                        <button className="btn-icon" title={t('workOrder.resume')} disabled={busyId === wo.id} onClick={() => doAction(wo, 'resume')}>
                          <Play size={16} />
                        </button>
                        <button className="btn-icon" title={t('workOrder.complete')} disabled={busyId === wo.id} onClick={() => doAction(wo, 'complete')}>
                          <CheckCircle2 size={16} />
                        </button>
                      </>
                    )}
                    {wo.status === 'completed' && (
                      <button className="btn-icon" title={t('workOrder.archive')} disabled={busyId === wo.id} onClick={() => doAction(wo, 'archive')}>
                        <Archive size={16} />
                      </button>
                    )}
                    {wo.status === 'draft' && (
                      <button className="btn-icon" title={t('common.delete')} disabled={busyId === wo.id} onClick={() => setDeleteTarget(wo)}>
                        <Trash2 size={16} />
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}

      <WorkOrderForm
        open={formOpen}
        onClose={() => setFormOpen(false)}
        onSaved={load}
        recipes={recipes}
      />

      <ConfirmDialog
        open={deleteTarget !== null}
        title={t('workOrder.delete')}
        message={t('workOrder.deleteConfirm', { name: deleteTarget?.orderNumber })}
        busy={busyId !== null}
        onConfirm={handleDelete}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  );
}
