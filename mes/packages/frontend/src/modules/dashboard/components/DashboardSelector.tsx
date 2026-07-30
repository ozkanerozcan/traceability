import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { LayoutDashboard } from 'lucide-react';
import { Alert, Badge } from '../../../core/components/common';
import { workOrderService, WO_STATUS_VARIANT, type WorkOrder } from '../../work-order/services/workOrder.service';
import { recipeService, type Recipe } from '../../recipe/services/recipe.service';
import { useWsMessage } from '../../../core/hooks/useWebSocket';

/** Ana sayfa: aktif/duraklatılmış iş emirleri arasından dashboard seçimi. */
export default function DashboardSelector() {
  const { t } = useTranslation();
  const [workOrders, setWorkOrders] = useState<WorkOrder[]>([]);
  const [recipes, setRecipes] = useState<Recipe[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [active, paused, recipeData] = await Promise.all([
        workOrderService.list({ status: 'active' }),
        workOrderService.list({ status: 'paused' }),
        recipeService.list(),
      ]);
      setWorkOrders([...active.workOrders, ...paused.workOrders]);
      setRecipes(recipeData.recipes);
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

  // Durum değişikliklerinde listeyi tazele (yeni aktif WO anında görünsün)
  useWsMessage('workorder:changed', useCallback(() => {
    void load();
  }, [load]));

  const recipeName = (id: number) => recipes.find((r) => r.id === id)?.name ?? `#${id}`;

  return (
    <div>
      <h1 style={{ fontSize: 'var(--font-size-2xl)', marginBottom: 'var(--space-6)' }}>
        {t('nav.dashboard')}
      </h1>

      {error && <Alert variant="danger" className="mb-4">{error}</Alert>}

      {loading ? (
        <p className="text-muted">{t('common.loading')}</p>
      ) : workOrders.length === 0 ? (
        <Alert variant="info">{t('dashboard.noActive')}</Alert>
      ) : (
        <div className="dashboard-selector">
          {workOrders.map((wo) => (
            <Link key={wo.id} to={`/dashboard/${wo.id}`} className="dashboard-card">
              <div className="dashboard-card-icon">
                <LayoutDashboard size={20} />
              </div>
              <div className="dashboard-card-body">
                <div className="dashboard-card-title">{wo.orderNumber}</div>
                <div className="text-muted" style={{ fontSize: 'var(--font-size-xs)' }}>
                  {recipeName(wo.recipeId)}
                </div>
              </div>
              <Badge variant={WO_STATUS_VARIANT[wo.status]}>
                {t(`workOrder.status.${wo.status}`)}
              </Badge>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
