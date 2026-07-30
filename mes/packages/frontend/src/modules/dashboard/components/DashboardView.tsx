import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { ArrowLeft } from 'lucide-react';
import { Alert, Badge } from '../../../core/components/common';
import { workOrderService, WO_STATUS_VARIANT, type WorkOrder } from '../../work-order/services/workOrder.service';
import { recipeService, type Recipe, type WidgetConfig } from '../../recipe/services/recipe.service';
import { plcService, tagService, type PlcTag } from '../../plc-gateway/services/plc.service';
import { useLiveValues } from '../hooks/useLiveValues';
import NumericWidget from '../widgets/NumericWidget';
import GaugeWidget from '../widgets/GaugeWidget';
import TrendWidget from '../widgets/TrendWidget';
import StatusWidget from '../widgets/StatusWidget';
import TableWidget from '../widgets/TableWidget';
import '../styles/dashboard.css';

interface Props {
  workOrderId: number;
}

/** Aktif iş emri dashboard'u — salt görüntüleme (view-only), canlı WS verisi. */
export default function DashboardView({ workOrderId }: Props) {
  const { t } = useTranslation();
  const [wo, setWo] = useState<WorkOrder | null>(null);
  const [recipe, setRecipe] = useState<Recipe | null>(null);
  const [tagMap, setTagMap] = useState<Map<number, PlcTag & { plcName?: string }>>(new Map());
  const [tagPlc, setTagPlc] = useState<Map<number, number>>(new Map());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [{ workOrder }] = await Promise.all([workOrderService.get(workOrderId)]);
        const [{ recipe: r }, { plcs }] = await Promise.all([
          recipeService.get(workOrder.recipeId),
          plcService.list(),
        ]);
        const groups = await Promise.all(
          plcs.map(async (plc) => {
            const { tags } = await tagService.list(plc.id);
            return { plcId: plc.id, plcName: plc.name, tags };
          })
        );
        if (cancelled) return;
        const map = new Map<number, PlcTag & { plcName?: string }>();
        const plcOf = new Map<number, number>();
        for (const g of groups) {
          for (const tag of g.tags) {
            map.set(tag.id, { ...tag, plcName: g.plcName });
            plcOf.set(tag.id, g.plcId);
          }
        }
        setWo(workOrder);
        setRecipe(r);
        setTagMap(map);
        setTagPlc(plcOf);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [workOrderId]);

  const widgets: WidgetConfig[] = useMemo(
    () => recipe?.dashboardLayout?.widgets ?? [],
    [recipe]
  );

  // Widget'lara bağlı tag'lerin ait olduğu PLC'lere abone ol
  const plcIds = useMemo(() => {
    const set = new Set<number>();
    for (const w of widgets) {
      if (typeof w.tagId === 'number') {
        const p = tagPlc.get(w.tagId);
        if (p) set.add(p);
      }
      for (const id of w.tagIds ?? []) {
        const p = tagPlc.get(id);
        if (p) set.add(p);
      }
    }
    return [...set];
  }, [widgets, tagPlc]);

  const liveValues = useLiveValues(plcIds);

  if (loading) {
    return <p className="text-muted">{t('common.loading')}</p>;
  }

  if (error || !wo || !recipe) {
    return (
      <div>
        <Alert variant="danger" className="mb-4">{error ?? t('workOrder.notFound')}</Alert>
        <Link to="/work-orders" className="btn-icon">
          <ArrowLeft size={18} />
        </Link>
      </div>
    );
  }

  const maxCols = 12;

  return (
    <div>
      <div className="flex items-center gap-3 mb-4" style={{ flexWrap: 'wrap' }}>
        <Link to="/work-orders" className="btn-icon" title={t('nav.workOrders')}>
          <ArrowLeft size={18} />
        </Link>
        <div style={{ flex: 1, minWidth: 0 }}>
          <h1 style={{ fontSize: 'var(--font-size-2xl)' }}>{wo.orderNumber}</h1>
          <p className="text-muted" style={{ fontSize: 'var(--font-size-sm)' }}>{recipe.name}</p>
        </div>
        <Badge variant={WO_STATUS_VARIANT[wo.status]}>{t(`workOrder.status.${wo.status}`)}</Badge>
      </div>

      {widgets.length === 0 ? (
        <Alert variant="info">{t('dashboard.noWidgets')}</Alert>
      ) : (
        <div className="dashboard-view">
          {widgets.map((w) => {
            const style: React.CSSProperties = {
              left: `calc(${(w.layout.x / maxCols) * 100}% + 6px)`,
              top: w.layout.y * 72 + 6,
              width: `calc(${(w.layout.w / maxCols) * 100}% - 12px)`,
              height: w.layout.h * 72 - 12,
            };
            const live = typeof w.tagId === 'number' ? liveValues.get(w.tagId) : undefined;
            return (
              <div key={w.id} className="dashboard-view-widget" style={style}>
                <div className="dashboard-view-widget-title">
                  {w.title || t(`recipe.widget.${w.type}`)}
                </div>
                <div className="dashboard-view-widget-body">
                  {w.type === 'numeric' && <NumericWidget widget={w} live={live} />}
                  {w.type === 'gauge' && <GaugeWidget widget={w} live={live} />}
                  {w.type === 'trend' && <TrendWidget widget={w} live={live} />}
                  {w.type === 'status' && <StatusWidget widget={w} live={live} />}
                  {w.type === 'table' && (
                    <TableWidget widget={w} liveValues={liveValues} tagMap={tagMap} />
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// Grid satır yüksekliği (dashboard.css ile uyumlu)
export const DASHBOARD_ROW_HEIGHT = 72;
