import { api } from '../../../core/services/api';

// ─── Tipler ─────────────────────────────────────────────────────────────────

export type StationCapability =
  | 'qr_generate'
  | 'trolley_assign'
  | 'batch_assign'
  | 'ok_nok'
  | 'plc_acquire'
  | 'wait_control'
  | 'alarm'
  | 'printing'
  | 'operator_confirm'
  | 'route_validate';

export interface StationConfig {
  plcId?: number;
  plcTagId?: number;
  torqueTagId?: number;
  positionTagId?: number;
  alarmTagId?: number;
  waitHours?: number;
  positions?: number;
  groupSize?: number;
  componentKind?: 'material' | 'component';
  fields?: string[];
  labelWidth?: number;  // QR etiket genişliği (mm)
  labelHeight?: number; // QR etiket yüksekliği (mm)
}

export interface Station {
  id: number;
  key: string;
  name: string;
  type: string;
  sortOrder: number;
  isActive: boolean;
  capabilities: StationCapability[];
  config: StationConfig;
}

export interface Route {
  id: number;
  name: string;
  is_active: number;
  isActive: boolean;
  steps: number[];
}

export interface Trolley {
  id: number;
  code: string;
  slotCount: number;
  isActive: boolean;
  slots: { slot_number: number; product_id: string }[];
}

export interface Product {
  id: number;
  product_id: string;
  status: 'in_progress' | 'completed' | 'rejected';
  route_id: number | null;
  current_step_index: number;
  qr_content: string | null;
  created_at: string;
  updated_at: string;
}

export interface StationRecord {
  id: number;
  product_id: string;
  station_id: number;
  station_name: string;
  station_key: string;
  trolley_id: number | null;
  status: string | null;
  data: string;
  batch_no: string | null;
  operator_id: number | null;
  created_at: string;
}

export interface Alarm {
  id: number;
  product_id: string | null;
  trolley_id: number | null;
  station_id: number | null;
  severity: 'info' | 'warning' | 'critical';
  message: string;
  acknowledged: number;
  created_at: string;
}

export interface ScanInput {
  stationKey: string;
  productId?: string;
  trolleyCode?: string;
  slotNumber?: number;
  status?: 'ok' | 'nok';
  batchNo?: string;
  data?: Record<string, unknown>;
  direction?: 'entry' | 'exit';
}

export interface ScanResult {
  ok: boolean;
  productId?: string;
  qrLabel?: { productId: string; svgPath: string; size: number };
  message?: string;
  advanced?: boolean;
  alarm?: boolean;
}

export interface QrLabel {
  productId: string;
  svgPath: string;
  size: number;
}

export interface QrHistoryItem {
  productId: string;
  qrContent: string;
  svgPath: string;
  size: number;
  status: 'in_progress' | 'completed' | 'rejected';
  createdAt: string | null;
}

// ─── API ────────────────────────────────────────────────────────────────────

export const traceService = {
  // İstasyonlar
  listStations: () => api.get<{ stations: Station[] }>('/api/trace/stations'),
  createStation: (input: { key: string; name: string; type?: string; capabilities?: string[]; config?: StationConfig }) =>
    api.post<{ station: Station }>('/api/trace/stations', input),
  updateStation: (id: number, input: Partial<{ name: string; type: string; is_active: boolean; capabilities: string[]; config: StationConfig; sort_order: number }>) =>
    api.put<{ station: Station }>(`/api/trace/stations/${id}`, input),
  deleteStation: (id: number) => api.delete<{ success: boolean }>(`/api/trace/stations/${id}`),

  // Rotalar
  listRoutes: () => api.get<{ routes: Route[] }>('/api/trace/routes'),
  createRoute: (name: string, stationIds?: number[]) =>
    api.post<{ route: { id: number; name: string } }>('/api/trace/routes', { name, stationIds }),
  setRouteSteps: (id: number, stationIds: number[]) =>
    api.put<{ success: boolean }>(`/api/trace/routes/${id}/steps`, { stationIds }),

  // Arabalar
  listTrolleys: () => api.get<{ trolleys: Trolley[] }>('/api/trace/trolleys'),
  createTrolley: (code: string, slotCount?: number) =>
    api.post<{ trolley: Trolley }>('/api/trace/trolleys', { code, slotCount }),

  // Ürünler
  listProducts: (opts?: { status?: string; limit?: number }) => {
    const qs = new URLSearchParams();
    if (opts?.status) qs.set('status', opts.status);
    if (opts?.limit) qs.set('limit', String(opts.limit));
    const suffix = qs.toString() ? `?${qs.toString()}` : '';
    return api.get<{ products: Product[] }>(`/api/trace/products${suffix}`);
  },
  getProduct: (productId: string) =>
    api.get<{ product: Product; records: StationRecord[] }>(`/api/trace/products/${encodeURIComponent(productId)}`),

  // Tarama
  scan: (input: ScanInput) => api.post<ScanResult>('/api/trace/scan', input),

  // QR etiket
  getQrLabel: (productId: string) =>
    api.get<QrLabel>(`/api/trace/qr/${encodeURIComponent(productId)}`),

  // QR geçmişi (son üretilen QR'lar)
  getQrHistory: (limit = 24) =>
    api.get<{ items: QrHistoryItem[] }>(`/api/trace/qr-history?limit=${limit}`),

  // Parti numaraları
  listBatches: (kind?: string) =>
    api.get<{ batches: { id: number; batch_no: string; kind: string; description: string | null }[] }>(
      `/api/trace/batches${kind ? `?kind=${kind}` : ''}`
    ),

  // Alarmlar
  listAlarms: (opts?: { activeOnly?: boolean; limit?: number }) => {
    const qs = new URLSearchParams();
    if (opts?.activeOnly) qs.set('activeOnly', 'true');
    if (opts?.limit) qs.set('limit', String(opts.limit));
    const suffix = qs.toString() ? `?${qs.toString()}` : '';
    return api.get<{ alarms: Alarm[] }>(`/api/trace/alarms${suffix}`);
  },
  ackAlarm: (id: number) => api.post<{ success: boolean }>(`/api/trace/alarms/${id}/ack`),
};

/** Capability etiketleri (i18n anahtarları) */
export const CAPABILITY_KEYS: StationCapability[] = [
  'qr_generate',
  'trolley_assign',
  'batch_assign',
  'ok_nok',
  'plc_acquire',
  'wait_control',
  'alarm',
  'printing',
  'operator_confirm',
  'route_validate',
];
