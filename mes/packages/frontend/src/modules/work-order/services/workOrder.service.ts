import { api } from '../../../core/services/api';

// ─── Tipler ─────────────────────────────────────────────────────────────────

export type WorkOrderStatus = 'draft' | 'active' | 'paused' | 'completed' | 'archived';

export interface WorkOrder {
  id: number;
  orderNumber: string;
  recipeId: number;
  status: WorkOrderStatus;
  startedAt: string | null;
  pausedAt: string | null;
  completedAt: string | null;
  createdBy: number | null;
  startedBy: number | null;
  completedBy: number | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface WorkOrderDataPoint {
  timestamp: string;
  tagId: number;
  value: number | null;
  valueText: string | null;
  quality: string;
}

// ─── API ────────────────────────────────────────────────────────────────────

export const workOrderService = {
  list: (params?: { status?: WorkOrderStatus; recipeId?: number }) => {
    const qs = new URLSearchParams();
    if (params?.status) qs.set('status', params.status);
    if (params?.recipeId) qs.set('recipeId', String(params.recipeId));
    const suffix = qs.toString() ? `?${qs.toString()}` : '';
    return api.get<{ workOrders: WorkOrder[] }>(`/api/work-orders${suffix}`);
  },
  get: (id: number) => api.get<{ workOrder: WorkOrder }>(`/api/work-orders/${id}`),
  create: (input: { recipeId: number; notes?: string | null }) =>
    api.post<{ workOrder: WorkOrder }>('/api/work-orders', input),
  update: (id: number, input: { notes?: string | null }) =>
    api.put<{ workOrder: WorkOrder }>(`/api/work-orders/${id}`, input),
  remove: (id: number) => api.delete<{ success: boolean }>(`/api/work-orders/${id}`),
  activate: (id: number) => api.post<{ workOrder: WorkOrder }>(`/api/work-orders/${id}/activate`),
  pause: (id: number) => api.post<{ workOrder: WorkOrder }>(`/api/work-orders/${id}/pause`),
  resume: (id: number) => api.post<{ workOrder: WorkOrder }>(`/api/work-orders/${id}/resume`),
  complete: (id: number) => api.post<{ workOrder: WorkOrder }>(`/api/work-orders/${id}/complete`),
  archive: (id: number) => api.post<{ workOrder: WorkOrder }>(`/api/work-orders/${id}/archive`),
  data: (id: number, opts?: { tagIds?: number[]; limit?: number }) => {
    const qs = new URLSearchParams();
    if (opts?.tagIds?.length) qs.set('tagIds', opts.tagIds.join(','));
    if (opts?.limit) qs.set('limit', String(opts.limit));
    const suffix = qs.toString() ? `?${qs.toString()}` : '';
    return api.get<{ data: WorkOrderDataPoint[] }>(`/api/work-orders/${id}/data${suffix}`);
  },
};

/** Durum rozetinin badge varyantı */
export const WO_STATUS_VARIANT: Record<WorkOrderStatus, 'muted' | 'success' | 'warning' | 'info' | 'danger'> = {
  draft: 'muted',
  active: 'success',
  paused: 'warning',
  completed: 'info',
  archived: 'muted',
};
