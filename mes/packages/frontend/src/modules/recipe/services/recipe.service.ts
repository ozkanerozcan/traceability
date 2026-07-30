import { api } from '../../../core/services/api';

// ─── Tipler ─────────────────────────────────────────────────────────────────

export type WidgetType = 'numeric' | 'gauge' | 'trend' | 'status' | 'table';

// ─── Dashboard Layout ───────────────────────────────────────────────────────

export interface WidgetLayout {
  x: number;
  y: number;
  w: number;
  h: number;
  minW?: number;
  minH?: number;
}

export interface WidgetOptions {
  // numeric / gauge / trend
  unit?: string;
  decimals?: number;
  // gauge
  min?: number;
  max?: number;
  warningHigh?: number;
  // trend
  windowSeconds?: number;
  yMin?: number | null;
  yMax?: number | null;
  // status
  trueLabel?: string;
  falseLabel?: string;
  // table
  showUnit?: boolean;
}

export interface WidgetConfig {
  id: string;
  type: WidgetType;
  title: string;
  /** numeric/gauge/trend/status için tekil PLC tag bağlantısı (plc_tags.id) */
  tagId?: number | null;
  /** table için çoklu PLC tag bağlantısı */
  tagIds?: number[];
  options: WidgetOptions;
  layout: WidgetLayout;
}

export interface DashboardLayout {
  widgets: WidgetConfig[];
}

// ─── Recipe ─────────────────────────────────────────────────────────────────

export interface Recipe {
  id: number;
  name: string;
  description: string | null;
  dashboardLayout: DashboardLayout | null;
  activeWorkOrders: number;
  totalWorkOrders: number;
  createdAt: string;
  updatedAt: string;
}

export interface RecipeInput {
  name: string;
  description?: string | null;
}

// ─── API ────────────────────────────────────────────────────────────────────

export const recipeService = {
  list: () => api.get<{ recipes: Recipe[] }>('/api/recipes'),
  get: (id: number) => api.get<{ recipe: Recipe }>(`/api/recipes/${id}`),
  create: (input: RecipeInput) => api.post<{ recipe: Recipe }>('/api/recipes', input),
  update: (id: number, input: Partial<RecipeInput>) =>
    api.put<{ recipe: Recipe }>(`/api/recipes/${id}`, input),
  remove: (id: number) => api.delete<{ success: boolean }>(`/api/recipes/${id}`),
  saveDashboard: (id: number, layout: DashboardLayout) =>
    api.put<{ recipe: Recipe }>(`/api/recipes/${id}/dashboard`, { layout }),
};

// ─── Yardımcılar ────────────────────────────────────────────────────────────

export const WIDGET_TYPES: WidgetType[] = ['numeric', 'gauge', 'trend', 'status', 'table'];

/** Paletten canvas'a yeni widget eklerken kullanılan varsayılan boyutlar */
export const WIDGET_DEFAULTS: Record<WidgetType, { w: number; h: number; minW: number; minH: number }> = {
  numeric: { w: 3, h: 2, minW: 2, minH: 2 },
  gauge: { w: 4, h: 4, minW: 3, minH: 3 },
  trend: { w: 6, h: 4, minW: 4, minH: 3 },
  status: { w: 3, h: 2, minW: 2, minH: 2 },
  table: { w: 6, h: 4, minW: 4, minH: 3 },
};

let widgetSeq = 0;
export function newWidgetId(): string {
  widgetSeq += 1;
  return `w-${Date.now().toString(36)}-${widgetSeq}`;
}
