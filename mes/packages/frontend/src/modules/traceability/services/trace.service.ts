import { api } from '../../../core/services/api';

// ─── Tipler ─────────────────────────────────────────────────────────────────

export type StationCapability =
  | 'qr_generate'
  | 'trolley_read'
  | 'trolley_assign'
  | 'batch_assign'
  | 'ok_nok'
  | 'plc_acquire'
  | 'wait_control'
  | 'alarm'
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
  // ─── PLC Data (plc_acquire) & Araba Atama (trolley_assign) ───
  dataTagIds?: number[];  // ürüne yazılacak tag'ler (slot tag de dahil)
  triggerTagId?: number;  // trigger biti
  // Shell ID kaynağı (yok/'scan' = taranan ürün; 'plc' = PLC'den; 'trolley' = arabadan)
  shellIdSource?: 'plc' | 'trolley';
  shellIdTagId?: number;        // shellIdSource='plc': Shell ID okunacak tag
  trolleyIdTagId?: number;      // shellIdSource='trolley': Trolley ID okunacak tag
  trolleyMatchMode?: 'row' | 'all'; // shellIdSource='trolley': satır bazlı / tüm ürünler
  rowTagId?: number;            // trolleyMatchMode='row': satır numarası tag'i
  rowSize?: number;             // satır başına ürün (varsayılan 4)
  /** trolley_read: okutunca önceki içerik otomatik temizlensin mi (varsayılan true; yalnız ilk/yükleme istasyonu) */
  clearOnRead?: boolean;
  slotTagId?: number;           // PLC'den okunan trolley slot numarası tag'i
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

export interface TrolleyProductItem {
  slotNumber: number;
  productId: string;
  status: string;
  stepIndex: number;
  records: {
    stationName: string;
    status: string | null;
    data: Record<string, unknown> | null;
    createdAt: string;
  }[];
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
  deleteTrolley: (id: number) => api.delete<{ success: boolean }>(`/api/trace/trolleys/${id}`),

  // Ürünler
  createProduct: () => api.post<{ product: Product; qrLabel: QrLabel }>('/api/trace/products'),
  listProducts: (opts?: { status?: string; limit?: number }) => {
    const qs = new URLSearchParams();
    if (opts?.status) qs.set('status', opts.status);
    if (opts?.limit) qs.set('limit', String(opts.limit));
    const suffix = qs.toString() ? `?${qs.toString()}` : '';
    return api.get<{ products: Product[] }>(`/api/trace/products${suffix}`);
  },
  getProduct: (productId: string) =>
    api.get<{ product: Product; records: StationRecord[] }>(`/api/trace/products/${encodeURIComponent(productId)}`),
  deleteProduct: (id: number) => api.delete<{ success: boolean }>(`/api/trace/products/${id}`),

  // Tarama
  scan: (input: ScanInput) => api.post<ScanResult>('/api/trace/scan', input),

  // İstasyon çalışma bağlamı (trolley_read: araba onayı)
  confirmTrolley: (stationKey: string, trolleyCode: string) =>
    api.post<{ ok: boolean; trolley: TrolleyContext }>(`/api/trace/stations/${encodeURIComponent(stationKey)}/trolley`, { trolleyCode }),
  clearTrolley: (stationKey: string) =>
    api.delete<{ success: boolean }>(`/api/trace/stations/${encodeURIComponent(stationKey)}/trolley`),
  getStationContext: (stationKey: string) =>
    api.get<{ trolley: TrolleyContext | null; trolleyItems?: TrolleyProductItem[]; productId: string | null; lastCapture: LastCapture | null }>(`/api/trace/stations/${encodeURIComponent(stationKey)}/context`),

  // Araba kapasitesi (slot_count) — kalıcı
  updateTrolley: (id: number, slotCount: number) =>
    api.put<{ trolley: TrolleyContext }>(`/api/trace/trolleys/${id}`, { slotCount }),

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
  'trolley_read',
  'trolley_assign',
  'batch_assign',
  'ok_nok',
  'plc_acquire',
  'wait_control',
  'alarm',
  'operator_confirm',
  'route_validate',
];

/** trolley_read: onaylanan arabanın çalışma bağlamı */
export interface TrolleyContext {
  id: number;
  code: string;
  slotCount: number;
  slots: { slot_number: number; product_id: string }[];
  nextFreeSlot: number | null;
}

/** PLC Data ile son yakalanan veri (trigger'dan) */
export interface LastCapture {
  productId: string;
  data: Record<string, unknown>;
  slot: number | null;
  at: string;
}
