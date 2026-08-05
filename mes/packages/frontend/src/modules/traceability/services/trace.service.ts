import { api } from '../../../core/services/api';

// ─── Tipler ─────────────────────────────────────────────────────────────────

/**
 * Sabit istasyon tipleri — her tip kendi özel ayarlarına ve çalışma sayfasına
 * sahiptir (eski yetenek/capability sistemi kaldırıldı).
 */
export type StationType =
  | 'qr_generate'
  | 'trolley_read'
  | 'funnel_screwing'
  | 'trolley_shell_matching'
  | 'filling'
  | 'probing';

export const STATION_TYPES: StationType[] = [
  'qr_generate',
  'trolley_read',
  'funnel_screwing',
  'trolley_shell_matching',
  'filling',
  'probing',
];

/** PLC'li istasyon tipleri (qr_generate PLC'sizdir) */
export const PLC_STATION_TYPES: StationType[] = [
  'trolley_read',
  'funnel_screwing',
  'trolley_shell_matching',
  'filling',
  'probing',
];

/**
 * Standart PLC sözleşmesi — her PLC'li istasyonun tag eşlemesi:
 *   ShellId / TrolleyId (string), SlotNumber / RowNumber (int), Trigger (bool),
 *   Data/<tagAdı> (dataTagIds) — Sonuç: Ack(bool), ErrorCode(int), ErrorMessage(string), Busy(bool)
 */
export interface StationConfig {
  plcId?: number;
  shellIdTagId?: number;
  trolleyIdTagId?: number;
  slotTagId?: number;
  rowTagId?: number;
  triggerTagId?: number;
  dataTagIds?: number[];
  ackTagId?: number;
  errorCodeTagId?: number;
  errorMessageTagId?: number;
  busyTagId?: number;
  clearOnRead?: boolean;
  labelWidth?: number;
  labelHeight?: number;
}

export interface Station {
  id: number;
  key: string;
  name: string;
  type: string;
  sortOrder: number;
  isActive: boolean;
  config: StationConfig;
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
  qr_content: string | null;
  trolley_code: string | null;
  slot_number: number | null;
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
  data: string | Record<string, unknown>;
  batch_no: string | null;
  operator_id: number | null;
  created_at: string;
}

export interface Measurement {
  id: number;
  shellId: string;
  stationKey: string;
  field: string;
  tagId: number | null;
  value: number | string | null;
  source: 'plc' | 'manual';
  createdAt: string;
  updatedAt: string;
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

/** Manuel tetikleme payload'ı — PLC'den gelmiş gibi işlenir */
export interface TriggerPayload {
  shellId?: string;
  trolleyId?: string;
  slotNumber?: number;
  rowNumber?: number;
  data?: Record<string, unknown>;
}

export interface TriggerResult {
  ok: boolean;
  message?: string;
  errorCode?: number;
  qrLabel?: QrLabel & { qrContent?: string; widthMm?: number; heightMm?: number };
}

export interface TrolleyProductItem {
  slotNumber: number;
  productId: string;
  status: string;
}

export interface TrolleyContext {
  id: number;
  code: string;
  slotCount: number;
  slots: { slot_number: number; product_id: string }[];
  nextFreeSlot: number | null;
}

/** Son yakalanan veri (runtime — DB'de saklanır) */
export interface LastCapture {
  at: string;
  summary: string;
  data: Record<string, unknown>;
  extra?: Record<string, unknown>;
}

export interface StationContextDto {
  trolley: TrolleyContext | null;
  trolleyItems: TrolleyProductItem[];
  lastCapture: LastCapture | null;
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
  createStation: (input: { key: string; name: string; type?: string; config?: StationConfig }) =>
    api.post<{ station: Station }>('/api/trace/stations', input),
  updateStation: (id: number, input: Partial<{ name: string; type: string; is_active: boolean; config: StationConfig; sort_order: number }>) =>
    api.put<{ station: Station }>(`/api/trace/stations/${id}`, input),
  deleteStation: (id: number) => api.delete<{ success: boolean }>(`/api/trace/stations/${id}`),

  // İstasyon tetikleme (manuel — "PLC'den gelmiş gibi" veri girişi)
  triggerStation: (stationKey: string, payload: TriggerPayload) =>
    api.post<TriggerResult>(`/api/trace/stations/${encodeURIComponent(stationKey)}/trigger`, payload),

  // İstasyon çalışma bağlamı (son araba + son yakalanan veri)
  getStationContext: (stationKey: string) =>
    api.get<StationContextDto>(`/api/trace/stations/${encodeURIComponent(stationKey)}/context`),

  // Ölçümler (web'den görüntüleme/ekleme/düzenleme/silme)
  listMeasurements: (productId: string, stationKey?: string) =>
    api.get<{ measurements: Measurement[] }>(
      `/api/trace/shells/${encodeURIComponent(productId)}/measurements${stationKey ? `?stationKey=${encodeURIComponent(stationKey)}` : ''}`
    ),
  listStationMeasurements: (stationKey: string, limit = 20) =>
    api.get<{ measurements: Measurement[] }>(`/api/trace/stations/${encodeURIComponent(stationKey)}/measurements?limit=${limit}`),
  createMeasurement: (input: { shellId: string; stationKey: string; field: string; value: number | string }) =>
    api.post<{ ok: boolean; measurements: Measurement[] }>('/api/trace/measurements', input),
  updateMeasurement: (id: number, value: number | string) =>
    api.put<{ measurement: Measurement }>(`/api/trace/measurements/${id}`, { value }),
  deleteMeasurement: (id: number) => api.delete<{ success: boolean }>(`/api/trace/measurements/${id}`),

  // Arabalar
  listTrolleys: () => api.get<{ trolleys: Trolley[] }>('/api/trace/trolleys'),
  createTrolley: (code: string, slotCount?: number) =>
    api.post<{ trolley: Trolley }>('/api/trace/trolleys', { code, slotCount }),
  updateTrolley: (id: number, slotCount: number) =>
    api.put<{ trolley: TrolleyContext }>(`/api/trace/trolleys/${id}`, { slotCount }),
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
    api.get<{ product: Product; records: StationRecord[]; measurements: Measurement[] }>(
      `/api/trace/products/${encodeURIComponent(productId)}`
    ),
  deleteProduct: (id: number) => api.delete<{ success: boolean }>(`/api/trace/products/${id}`),

  // QR etiket + geçmiş
  getQrLabel: (productId: string) =>
    api.get<QrLabel>(`/api/trace/qr/${encodeURIComponent(productId)}`),
  getQrHistory: (limit = 24) =>
    api.get<{ items: QrHistoryItem[] }>(`/api/trace/qr-history?limit=${limit}`),

  // Önerilen Shell ID
  getNextShellId: () => api.get<{ shellId: string }>('/api/trace/next-shell-id'),

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
