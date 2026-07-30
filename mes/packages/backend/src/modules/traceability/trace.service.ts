import { getDb } from '../../core/database/connection.js';

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

export function createTrolley(code: string, slotCount = 20): TrolleyRow {
  const db = getDb();
  const res = db
    .prepare('INSERT INTO trace_trolleys (code, slot_count) VALUES (?, ?)')
    .run(code, slotCount);
  return db.prepare('SELECT * FROM trace_trolleys WHERE id = ?').get(Number(res.lastInsertRowid)) as TrolleyRow;
}

export function getTrolleySlots(trolleyId: number): { slot_number: number; product_id: string }[] {
  const db = getDb();
  return db
    .prepare(
      `SELECT slot_number, product_id FROM trace_trolley_slots
       WHERE trolley_id = ? AND released_at IS NULL ORDER BY slot_number`
    )
    .all(trolleyId) as { slot_number: number; product_id: string }[];
}

export function assignTrolleySlot(trolleyId: number, slotNumber: number, productId: string): void {
  const db = getDb();
  db.prepare(
    `INSERT INTO trace_trolley_slots (trolley_id, slot_number, product_id) VALUES (?, ?, ?)`
  ).run(trolleyId, slotNumber, productId);
}

export function releaseTrolley(trolleyId: number): void {
  const db = getDb();
  db.prepare(
    "UPDATE trace_trolley_slots SET released_at = datetime('now') WHERE trolley_id = ? AND released_at IS NULL"
  ).run(trolleyId);
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
      `INSERT INTO trace_products (product_id, route_id, qr_content, current_step_index)
       VALUES (?, ?, ?, 0)`
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
  db.prepare(
    `INSERT INTO trace_station_records (product_id, station_id, trolley_id, status, data, batch_no, operator_id)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(
    input.productId,
    input.stationId,
    input.trolleyId ?? null,
    input.status ?? null,
    JSON.stringify(input.data ?? {}),
    input.batchNo ?? null,
    input.operatorId ?? null
  );
}

export function getProductRecords(productId: string): Record<string, unknown>[] {
  const db = getDb();
  return db
    .prepare(
      `SELECT r.*, s.name AS station_name, s.key AS station_key
       FROM trace_station_records r JOIN trace_stations s ON s.id = r.station_id
       WHERE r.product_id = ? ORDER BY r.id`
    )
    .all(productId) as Record<string, unknown>[];
}

/** İstasyonda ürün için belirli bir kayıt var mı (task kontrolü) */
export function hasRecord(productId: string, stationId: number, status?: string): boolean {
  const db = getDb();
  let sql = 'SELECT COUNT(*) AS c FROM trace_station_records WHERE product_id = ? AND station_id = ?';
  const params: unknown[] = [productId, stationId];
  if (status) {
    sql += ' AND status = ?';
    params.push(status);
  }
  return (db.prepare(sql).get(...params) as { c: number }).c > 0;
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
