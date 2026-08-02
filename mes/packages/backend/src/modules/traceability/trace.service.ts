import { getDb } from '../../core/database/connection.js';

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

export interface StationRow {
  id: number;
  key: string;
  name: string;
  type: string;
  sort_order: number;
  is_active: number;
  capabilities: string; // JSON
  config: string; // JSON
}

export interface ProductRow {
  id: number;
  product_id: string;
  status: 'in_progress' | 'completed' | 'rejected';
  route_id: number | null;
  current_step_index: number;
  qr_content: string | null;
  trolley_code: string | null;
  slot_number: number | null;
  plc_data: string;
  history: string;
  created_at?: string;
  updated_at?: string;
}

export interface TrolleyRow {
  id: number;
  code: string;
  slot_count: number;
  is_active: number;
}

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
  fields?: string[]; // plc_acquire için alan adları
  labelWidth?: number;  // QR etiket genişliği (mm)
  labelHeight?: number; // QR etiket yüksekliği (mm)
  // ─── PLC Data (plc_acquire) ───
  dataTagIds?: number[];  // ürüne yazılacak tag'ler (slot tag de dahil)
  triggerTagId?: number;  // trigger biti — true olunca dataTagIds ürüne yazılır
  // Shell ID kaynağı — trigger'da verinin hangi ürün(ler)e yazılacağı:
  //   yok/'scan'    → taranan AKTİF ürün (barkod okutulur)
  //   'plc'         → Shell ID doğrudan PLC tag'inden okunur (shellIdTagId)
  //   'trolley'     → onaylı arabadaki ürünler (satır bazlı / tüm ürünler)
  shellIdSource?: 'plc' | 'trolley';
  shellIdTagId?: number;        // shellIdSource='plc': Shell ID okunacak tag
  trolleyIdTagId?: number;      // shellIdSource='trolley': Trolley ID okunacak tag
  trolleyMatchMode?: 'row' | 'all'; // shellIdSource='trolley': eşleştirme yöntemi
  rowTagId?: number;            // trolleyMatchMode='row': satır numarası tag'i
  rowSize?: number;             // satır başına ürün sayısı (varsayılan 4)
  slotTagId?: number;           // PLC'den okunan trolley slot numarası tag'i
  /**
   * trolley_read: araba okutulduğunda önceki içerik OTOMATİK temizlensin mi?
   * Yalnızca İLK/yükleme istasyonunda true olmalı (varsayılan true) — sonraki
   * istasyonlar yüklü arabayı okurken false'a çekilmeli (ürünler silinmez).
   */
  clearOnRead?: boolean;
}

export function parseCapabilities(json: string): StationCapability[] {
  try {
    return JSON.parse(json) as StationCapability[];
  } catch {
    return [];
  }
}

export function parseConfig(json: string): StationConfig {
  try {
    return JSON.parse(json) as StationConfig;
  } catch {
    return {};
  }
}

// ─── İstasyonlar ────────────────────────────────────────────────────────────

export function listStations(): StationRow[] {
  const db = getDb();
  return db.prepare('SELECT * FROM trace_stations ORDER BY sort_order').all() as StationRow[];
}

export function getStation(id: number): StationRow | undefined {
  const db = getDb();
  return db.prepare('SELECT * FROM trace_stations WHERE id = ?').get(id) as StationRow | undefined;
}

export function getStationByKey(key: string): StationRow | undefined {
  const db = getDb();
  return db.prepare('SELECT * FROM trace_stations WHERE key = ?').get(key) as StationRow | undefined;
}

export function createStation(input: {
  key: string;
  name: string;
  type?: string;
  capabilities?: string[];
  config?: StationConfig;
}): StationRow {
  const db = getDb();
  const maxOrder = (db.prepare('SELECT COALESCE(MAX(sort_order),-1) AS m FROM trace_stations').get() as { m: number }).m;
  const res = db
    .prepare(
      `INSERT INTO trace_stations (key, name, type, sort_order, capabilities, config)
       VALUES (?, ?, ?, ?, ?, ?)`
    )
    .run(
      input.key,
      input.name,
      input.type ?? 'generic',
      maxOrder + 1,
      JSON.stringify(input.capabilities ?? []),
      JSON.stringify(input.config ?? {})
    );
  return getStation(Number(res.lastInsertRowid))!;
}

export function updateStation(
  id: number,
  input: Partial<{ name: string; type: string; is_active: boolean; capabilities: string[]; config: StationConfig; sort_order: number }>
): StationRow | undefined {
  const db = getDb();
  const existing = getStation(id);
  if (!existing) return undefined;
  db.prepare(
    `UPDATE trace_stations SET name = ?, type = ?, is_active = ?, capabilities = ?, config = ?,
       sort_order = ?, updated_at = datetime('now') WHERE id = ?`
  ).run(
    input.name ?? existing.name,
    input.type ?? existing.type,
    input.is_active === undefined ? existing.is_active : input.is_active ? 1 : 0,
    JSON.stringify(input.capabilities ?? parseCapabilities(existing.capabilities)),
    JSON.stringify(input.config ?? parseConfig(existing.config)),
    input.sort_order ?? existing.sort_order,
    id
  );
  return getStation(id);
}

export function deleteStation(id: number): boolean {
  const db = getDb();
  const res = db.prepare('DELETE FROM trace_stations WHERE id = ?').run(id);
  return res.changes > 0;
}

// ─── Rotalar ────────────────────────────────────────────────────────────────

export function listRoutes(): { id: number; name: string; is_active: number }[] {
  const db = getDb();
  return db.prepare('SELECT * FROM trace_routes ORDER BY id').all() as {
    id: number;
    name: string;
    is_active: number;
  }[];
}

export function getRouteSteps(routeId: number): { station_id: number; sequence: number }[] {
  const db = getDb();
  return db
    .prepare('SELECT station_id, sequence FROM trace_route_steps WHERE route_id = ? ORDER BY sequence')
    .all(routeId) as { station_id: number; sequence: number }[];
}

export function setRouteSteps(routeId: number, stationIds: number[]): void {
  const db = getDb();
  const tx = db.transaction(() => {
    db.prepare('DELETE FROM trace_route_steps WHERE route_id = ?').run(routeId);
    const insert = db.prepare(
      'INSERT INTO trace_route_steps (route_id, station_id, sequence) VALUES (?, ?, ?)'
    );
    stationIds.forEach((sid, i) => insert.run(routeId, sid, i));
  });
  tx();
}

export function createRoute(name: string): { id: number; name: string } {
  const db = getDb();
  const res = db.prepare('INSERT INTO trace_routes (name) VALUES (?)').run(name);
  return { id: Number(res.lastInsertRowid), name };
}

/** Rotanın sıradaki istasyonu (ürünün current_step_index'ine göre) */
export function getNextStationForProduct(product: ProductRow): StationRow | undefined {
  if (!product.route_id) return undefined;
  const db = getDb();
  const step = db
    .prepare(
      `SELECT station_id FROM trace_route_steps WHERE route_id = ? AND sequence = ?`
    )
    .get(product.route_id, product.current_step_index) as { station_id: number } | undefined;
  if (!step) return undefined;
  return getStation(step.station_id);
}

// ─── Arabalar ───────────────────────────────────────────────────────────────

export function listTrolleys(): TrolleyRow[] {
  const db = getDb();
  return db.prepare('SELECT * FROM trace_trolleys ORDER BY id').all() as TrolleyRow[];
}

export function getTrolleyByCode(code: string): TrolleyRow | undefined {
  const db = getDb();
  return db.prepare('SELECT * FROM trace_trolleys WHERE code = ?').get(code) as TrolleyRow | undefined;
}

export function getTrolley(id: number): TrolleyRow | undefined {
  const db = getDb();
  return db.prepare('SELECT * FROM trace_trolleys WHERE id = ?').get(id) as TrolleyRow | undefined;
}

/** Arabanın ilk boş slot numarası (1..slotCount); dolu ise null */
export function nextFreeSlot(trolleyId: number, slotCount: number): number | null {
  const used = new Set(getTrolleySlots(trolleyId).map((s) => s.slot_number));
  for (let i = 1; i <= slotCount; i++) {
    if (!used.has(i)) return i;
  }
  return null;
}

export function createTrolley(code: string, slotCount = 20): TrolleyRow {
  const db = getDb();
  const res = db
    .prepare('INSERT INTO trace_trolleys (code, slot_count) VALUES (?, ?)')
    .run(code, slotCount);
  return db.prepare('SELECT * FROM trace_trolleys WHERE id = ?').get(Number(res.lastInsertRowid)) as TrolleyRow;
}

/** Arabanın kapasitesini (slot sayısı) günceller — kalıcıdır, sıfırlamada silinmez. */
export function updateTrolleySlotCount(id: number, slotCount: number): TrolleyRow | undefined {
  const db = getDb();
  const count = Math.max(1, Math.min(100, Math.floor(slotCount)));
  db.prepare('UPDATE trace_trolleys SET slot_count = ? WHERE id = ?').run(count, id);
  return getTrolley(id);
}

export function deleteTrolley(id: number): boolean {
  const db = getDb();
  const trolley = getTrolley(id);
  if (!trolley) return false;

  const transaction = db.transaction(() => {
    db.prepare('UPDATE trace_products SET trolley_code = NULL, slot_number = NULL WHERE trolley_code = ?').run(trolley.code);
    db.prepare('DELETE FROM trace_alarms WHERE trolley_id = ?').run(id);
    const res = db.prepare('DELETE FROM trace_trolleys WHERE id = ?').run(id);

    for (const [, ctx] of stationContexts.entries()) {
      if (ctx.trolleyId === id) {
        ctx.trolleyId = null;
        ctx.trolleyCode = null;
      }
    }

    return res.changes > 0;
  });

  return transaction();
}

export function getTrolleySlots(trolleyId: number): { slot_number: number; product_id: string }[] {
  const trolley = getTrolley(trolleyId);
  if (!trolley) return [];
  const db = getDb();
  return db
    .prepare(
      `SELECT slot_number, product_id FROM trace_products
       WHERE trolley_code = ? AND slot_number IS NOT NULL ORDER BY slot_number`
    )
    .all(trolley.code) as { slot_number: number; product_id: string }[];
}

export function assignTrolleySlot(trolleyId: number, slotNumber: number, productId: string): void {
  const trolley = getTrolley(trolleyId);
  if (!trolley) return;
  const db = getDb();
  db.prepare(
    `UPDATE trace_products SET trolley_code = ?, slot_number = ?, updated_at = datetime('now') WHERE product_id = ?`
  ).run(trolley.code, slotNumber, productId);
}

export function releaseTrolley(trolleyId: number): void {
  const trolley = getTrolley(trolleyId);
  if (!trolley) return;
  const db = getDb();
  db.prepare(
    "UPDATE trace_products SET trolley_code = NULL, slot_number = NULL, updated_at = datetime('now') WHERE trolley_code = ?"
  ).run(trolley.code);
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

export function getTrolleyProductItems(trolleyId: number): TrolleyProductItem[] {
  const trolley = getTrolley(trolleyId);
  if (!trolley) return [];
  const db = getDb();
  const products = db
    .prepare('SELECT * FROM trace_products WHERE trolley_code = ? AND slot_number IS NOT NULL ORDER BY slot_number')
    .all(trolley.code) as ProductRow[];

  return products.map((p) => {
    let history: { stationName?: string; status?: string; data?: Record<string, unknown>; createdAt?: string }[] = [];
    try {
      history = JSON.parse(p.history ?? '[]');
    } catch {
      history = [];
    }
    return {
      slotNumber: p.slot_number!,
      productId: p.product_id,
      status: p.status,
      stepIndex: p.current_step_index,
      records: history.map((h) => ({
        stationName: h.stationName ?? '—',
        status: h.status ?? null,
        data: h.data ?? null,
        createdAt: h.createdAt ?? '',
      })),
    };
  });
}

// ─── Ürünler ────────────────────────────────────────────────────────────────

export function generateProductId(date = new Date()): string {
  const db = getDb();
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  const prefix = `SH-${y}${m}${d}-`;
  const row = db
    .prepare(
      `SELECT product_id FROM trace_products WHERE product_id LIKE ? ORDER BY product_id DESC LIMIT 1`
    )
    .get(`${prefix}%`) as { product_id: string } | undefined;
  const seq = row ? Number(row.product_id.slice(prefix.length)) + 1 : 1;
  return `${prefix}${String(seq).padStart(4, '0')}`;
}

export function createProduct(input: { productId: string; routeId?: number | null; qrContent?: string }): ProductRow {
  const db = getDb();
  const res = db
    .prepare(
      `INSERT INTO trace_products (product_id, route_id, qr_content, current_step_index, plc_data, history)
       VALUES (?, ?, ?, 0, '{}', '[]')`
    )
    .run(input.productId, input.routeId ?? null, input.qrContent ?? input.productId);
  return getProduct(Number(res.lastInsertRowid))!;
}

export function getProduct(id: number): ProductRow | undefined {
  const db = getDb();
  return db.prepare('SELECT * FROM trace_products WHERE id = ?').get(id) as ProductRow | undefined;
}

export function getProductByProductId(productId: string): ProductRow | undefined {
  const db = getDb();
  return db.prepare('SELECT * FROM trace_products WHERE product_id = ?').get(productId) as ProductRow | undefined;
}

export function listProducts(opts: { status?: string; limit?: number } = {}): ProductRow[] {
  const db = getDb();
  const limit = Math.min(opts.limit ?? 200, 1000);
  if (opts.status) {
    return db
      .prepare('SELECT * FROM trace_products WHERE status = ? ORDER BY id DESC LIMIT ?')
      .all(opts.status, limit) as ProductRow[];
  }
  return db.prepare('SELECT * FROM trace_products ORDER BY id DESC LIMIT ?').all(limit) as ProductRow[];
}

export function advanceProduct(productId: string): void {
  const db = getDb();
  db.prepare(
    "UPDATE trace_products SET current_step_index = current_step_index + 1, updated_at = datetime('now') WHERE product_id = ?"
  ).run(productId);
}

export function setProductStatus(productId: string, status: 'in_progress' | 'completed' | 'rejected'): void {
  const db = getDb();
  db.prepare(
    "UPDATE trace_products SET status = ?, updated_at = datetime('now') WHERE product_id = ?"
  ).run(status, productId);
}

export function deleteProduct(id: number): boolean {
  const db = getDb();
  const product = getProduct(id);
  if (!product) return false;

  const transaction = db.transaction(() => {
    db.prepare('DELETE FROM trace_alarms WHERE product_id = ?').run(product.product_id);
    const res = db.prepare('DELETE FROM trace_products WHERE id = ?').run(id);
    return res.changes > 0;
  });

  return transaction();
}

// ─── İstasyon kayıtları ─────────────────────────────────────────────────────

export function addStationRecord(input: {
  productId: string;
  stationId: number;
  trolleyId?: number | null;
  status?: string | null;
  data?: Record<string, unknown>;
  batchNo?: string | null;
  operatorId?: number | null;
}): void {
  const db = getDb();
  const product = getProductByProductId(input.productId);
  if (!product) return;

  const station = getStation(input.stationId);
  let history: Record<string, unknown>[] = [];
  try {
    history = JSON.parse(product.history ?? '[]');
  } catch {
    history = [];
  }

  let existingPlcData: Record<string, unknown> = {};
  try {
    existingPlcData = JSON.parse(product.plc_data ?? '{}');
  } catch {
    existingPlcData = {};
  }

  const nowStr = new Date().toISOString().replace('T', ' ').substring(0, 19);
  const newRecord = {
    id: history.length + 1,
    product_id: input.productId,
    station_id: input.stationId,
    stationId: input.stationId,
    station_key: station?.key ?? '',
    station_name: station?.name ?? '',
    stationName: station?.name ?? '',
    status: input.status ?? 'ok',
    data: input.data ?? {},
    batch_no: input.batchNo ?? null,
    operator_id: input.operatorId ?? null,
    created_at: nowStr,
    createdAt: nowStr,
  };

  history.push(newRecord);
  const mergedPlcData = { ...existingPlcData, ...(input.data ?? {}) };

  db.prepare(
    `UPDATE trace_products SET history = ?, plc_data = ?, updated_at = datetime('now') WHERE product_id = ?`
  ).run(JSON.stringify(history), JSON.stringify(mergedPlcData), input.productId);
}

export function getProductRecords(productId: string): Record<string, unknown>[] {
  const product = getProductByProductId(productId);
  if (!product) return [];
  try {
    return JSON.parse(product.history ?? '[]');
  } catch {
    return [];
  }
}

/** İstasyonda ürün için belirli bir kayıt var mı (task kontrolü) */
export function hasRecord(productId: string, stationId: number, status?: string): boolean {
  const records = getProductRecords(productId);
  return records.some(
    (r) => (r.station_id === stationId || r.stationId === stationId) && (!status || r.status === status)
  );
}

// ─── Parti numaraları ───────────────────────────────────────────────────────

export function listBatches(kind?: string): Record<string, unknown>[] {
  const db = getDb();
  if (kind) {
    return db.prepare('SELECT * FROM trace_batches WHERE kind = ? ORDER BY id DESC').all(kind) as Record<string, unknown>[];
  }
  return db.prepare('SELECT * FROM trace_batches ORDER BY id DESC').all() as Record<string, unknown>[];
}

export function createBatch(batchNo: string, kind: 'material' | 'component', description?: string): void {
  const db = getDb();
  db.prepare('INSERT OR IGNORE INTO trace_batches (batch_no, kind, description) VALUES (?, ?, ?)').run(
    batchNo,
    kind,
    description ?? null
  );
}

// ─── Alarmlar ───────────────────────────────────────────────────────────────

export function addAlarm(input: {
  productId?: string | null;
  trolleyId?: number | null;
  stationId?: number | null;
  severity?: 'info' | 'warning' | 'critical';
  message: string;
}): number {
  const db = getDb();
  const res = db
    .prepare(
      `INSERT INTO trace_alarms (product_id, trolley_id, station_id, severity, message)
       VALUES (?, ?, ?, ?, ?)`
    )
    .run(
      input.productId ?? null,
      input.trolleyId ?? null,
      input.stationId ?? null,
      input.severity ?? 'warning',
      input.message
    );
  return Number(res.lastInsertRowid);
}

export function listAlarms(opts: { activeOnly?: boolean; limit?: number } = {}): Record<string, unknown>[] {
  const db = getDb();
  const limit = Math.min(opts.limit ?? 100, 500);
  if (opts.activeOnly) {
    return db
      .prepare('SELECT * FROM trace_alarms WHERE acknowledged = 0 ORDER BY id DESC LIMIT ?')
      .all(limit) as Record<string, unknown>[];
  }
  return db.prepare('SELECT * FROM trace_alarms ORDER BY id DESC LIMIT ?').all(limit) as Record<string, unknown>[];
}

export function acknowledgeAlarm(id: number, userId: number): void {
  const db = getDb();
  db.prepare(
    "UPDATE trace_alarms SET acknowledged = 1, acknowledged_by = ?, acknowledged_at = datetime('now') WHERE id = ?"
  ).run(userId, id);
}

// ─── QR günlüğü ─────────────────────────────────────────────────────────────

/** Son üretilen QR'lar (ürünler) — önizleme/yeniden yazdırma listesi için */
export function listQrHistory(limit = 24): ProductRow[] {
  const db = getDb();
  const lim = Math.min(Math.max(limit, 1), 200);
  return db
    .prepare('SELECT * FROM trace_products ORDER BY id DESC LIMIT ?')
    .all(lim) as ProductRow[];
}

export function logQrPrint(productId: string, qrContent: string, userId: number): void {
  const db = getDb();
  db.prepare('INSERT INTO trace_qr_logs (product_id, qr_content, printed_by) VALUES (?, ?, ?)').run(
    productId,
    qrContent,
    userId
  );
}

// ─── İstasyon çalışma bağlamı (runtime, bellek içi) ──────────────────────

/**
 * Operatörün istasyon sayfasında onayladığı araba (trolley) ve son okuttuğu
 * ürün (product). PLC Data trigger'ı veriyi AKTİF ürüne yazar; trolley_read
 * ürünü AKTİF arabaya işler. Bellek içindedir — sunucu yeniden başlatılırsa
 * operatör arabayı/ürünü yeniden onaylar.
 */
export interface LastCapture {
  productId: string;
  data: Record<string, unknown>;
  slot: number | null;
  at: string; // ISO zaman damgası
}

export interface StationContext {
  trolleyId: number | null;
  trolleyCode: string | null;
  productId: string | null;
  /** PLC Data ile son yakalanan veri (trigger'dan) — UI'da gösterim için */
  lastCapture: LastCapture | null;
}

const stationContexts = new Map<number, StationContext>();

function emptyContext(): StationContext {
  return { trolleyId: null, trolleyCode: null, productId: null, lastCapture: null };
}

export function getStationContext(stationId: number): StationContext {
  return stationContexts.get(stationId) ?? emptyContext();
}

export function setActiveTrolley(stationId: number, trolleyId: number, trolleyCode: string): void {
  const ctx = stationContexts.get(stationId) ?? emptyContext();
  ctx.trolleyId = trolleyId;
  ctx.trolleyCode = trolleyCode;
  stationContexts.set(stationId, ctx);
}

export function clearActiveTrolley(stationId: number): void {
  const ctx = stationContexts.get(stationId);
  if (ctx) {
    ctx.trolleyId = null;
    ctx.trolleyCode = null;
  }
}

export function setActiveProduct(stationId: number, productId: string | null): void {
  const ctx = stationContexts.get(stationId) ?? emptyContext();
  ctx.productId = productId;
  stationContexts.set(stationId, ctx);
}

export function clearActiveProduct(stationId: number): void {
  const ctx = stationContexts.get(stationId);
  if (ctx) ctx.productId = null;
}

export function setLastCapture(stationId: number, capture: LastCapture): void {
  const ctx = stationContexts.get(stationId) ?? emptyContext();
  ctx.lastCapture = capture;
  stationContexts.set(stationId, ctx);
}
