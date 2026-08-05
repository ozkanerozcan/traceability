import { getDb } from '../../core/database/connection.js';

// ─── Tipler ─────────────────────────────────────────────────────────────────

/**
 * Sabit istasyon tipleri — her tip kendi özel ayarlarına, PLC sözleşmesine ve
 * çalışma sayfasına sahiptir (eski yetenek/capability sistemi kaldırıldı).
 * Yeni istasyon tipleri ileride bu listeye eklenebilir.
 */
export type StationType =
  | 'qr_generate'            // QR Kod Üretim — PLC'siz, Shell ID + QR üretir
  | 'trolley_read'           // Trolley Okuma — PLC'den yalnız TrolleyId
  | 'funnel_screwing'        // Funnel Sıkma — ShellId + Data (tork)
  | 'trolley_shell_matching' // Trolley-Shell Eşleştirme — ShellId + SlotNumber
  | 'filling'                // Dolum — TrolleyId + RowNumber + Data (satırdaki tüm shell'ler)
  | 'probing';               // Problama — TrolleyId + Data (arabadaki tüm shell'ler)

/** Trigger'ı izlenen PLC'li istasyon tipleri (qr_generate PLC'sizdir) */
export const PLC_STATION_TYPES: StationType[] = [
  'trolley_read',
  'funnel_screwing',
  'trolley_shell_matching',
  'filling',
  'probing',
];

export interface StationRow {
  id: number;
  key: string;
  name: string;
  type: string;
  sort_order: number;
  is_active: number;
  config: string; // JSON
}

export interface ProductRow {
  id: number;
  product_id: string;
  status: 'in_progress' | 'completed' | 'rejected';
  qr_content: string | null;
  trolley_code: string | null;
  slot_number: number | null;
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

/**
 * Standart PLC sözleşmesi — her PLC'li istasyonun tag eşlemesi.
 *
 *   ShellId    (R/W string)  — okunan/atanacak ürün
 *   TrolleyId  (R/W string)  — okunan/atanacak araba
 *   SlotNumber (R/W int)     — araba üzerindeki TEK yuva (1..capacity)
 *   RowNumber  (R/W int)     — araba üzerindeki SATIR (1 satır = row_size yuva)
 *   Trigger    (R/W bool)    — PLC "işle" komutu (subscribe, yükselen kenar)
 *   Data/<tagAdı> (R/W)      — istasyona tanımlı ölçüm alanları (dataTagIds)
 *
 * Sonuç (işlem bitince MES → PLC yazar):
 *   Ack(bool)  — başarılı (200 OK karşılığı)
 *   ErrorCode(int) — 0 = hata yok; hata kodları station.engine.PLC_ERR
 *   ErrorMessage(string) — hata açıklaması
 *   Busy(bool) — MES işlerken true
 */
export interface StationConfig {
  plcId?: number;
  shellIdTagId?: number;        // ShellId (string)
  trolleyIdTagId?: number;      // TrolleyId (string)
  slotTagId?: number;           // SlotNumber (int)
  rowTagId?: number;            // RowNumber (int) — filling
  triggerTagId?: number;        // Trigger (bool, subscribe)
  dataTagIds?: number[];        // Data/<tagAdı> ölçüm alanları
  ackTagId?: number;            // Ack (bool)
  errorCodeTagId?: number;      // ErrorCode (int)
  errorMessageTagId?: number;   // ErrorMessage (string)
  busyTagId?: number;           // Busy (bool)
  /** trolley_read: araba okutulduğunda önceki slot içeriği temizlensin mi (varsayılan true) */
  clearOnRead?: boolean;
  labelWidth?: number;          // qr_generate — etiket genişliği (mm)
  labelHeight?: number;         // qr_generate — etiket yüksekliği (mm)
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
  config?: StationConfig;
}): StationRow {
  const db = getDb();
  const maxOrder = (db.prepare('SELECT COALESCE(MAX(sort_order),-1) AS m FROM trace_stations').get() as { m: number }).m;
  const res = db
    .prepare(
      `INSERT INTO trace_stations (key, name, type, sort_order, config)
       VALUES (?, ?, ?, ?, ?)`
    )
    .run(
      input.key,
      input.name,
      input.type ?? 'legacy',
      maxOrder + 1,
      JSON.stringify(input.config ?? {})
    );
  return getStation(Number(res.lastInsertRowid))!;
}

export function updateStation(
  id: number,
  input: Partial<{ name: string; type: string; is_active: boolean; config: StationConfig; sort_order: number }>
): StationRow | undefined {
  const db = getDb();
  const existing = getStation(id);
  if (!existing) return undefined;
  db.prepare(
    `UPDATE trace_stations SET name = ?, type = ?, is_active = ?, config = ?,
       sort_order = ?, updated_at = datetime('now') WHERE id = ?`
  ).run(
    input.name ?? existing.name,
    input.type ?? existing.type,
    input.is_active === undefined ? existing.is_active : input.is_active ? 1 : 0,
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

// ─── Arabalar ───────────────────────────────────────────────────────────────

export function listTrolleys(): TrolleyRow[] {
  const db = getDb();
  return db.prepare('SELECT id, trolley_id AS code, capacity AS slot_count, is_active FROM trolleys ORDER BY id').all() as TrolleyRow[];
}

export function getTrolleyByCode(code: string): TrolleyRow | undefined {
  const db = getDb();
  return db.prepare('SELECT id, trolley_id AS code, capacity AS slot_count, is_active FROM trolleys WHERE trolley_id = ?').get(code) as TrolleyRow | undefined;
}

export function getTrolley(id: number): TrolleyRow | undefined {
  const db = getDb();
  return db.prepare('SELECT id, trolley_id AS code, capacity AS slot_count, is_active FROM trolleys WHERE id = ?').get(id) as TrolleyRow | undefined;
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
    .prepare('INSERT INTO trolleys (trolley_id, capacity) VALUES (?, ?)')
    .run(code, slotCount);
  return getTrolley(Number(res.lastInsertRowid))!;
}

/** Arabanın kapasitesini (slot sayısı) günceller — kalıcıdır, sıfırlamada silinmez. */
export function updateTrolleySlotCount(id: number, slotCount: number): TrolleyRow | undefined {
  const db = getDb();
  const count = Math.max(1, Math.min(100, Math.floor(slotCount)));
  db.prepare('UPDATE trolleys SET capacity = ? WHERE id = ?').run(count, id);
  return getTrolley(id);
}

export function deleteTrolley(id: number): boolean {
  const db = getDb();
  const trolley = getTrolley(id);
  if (!trolley) return false;

  const transaction = db.transaction(() => {
    db.prepare('UPDATE shells SET trolley_id = NULL, slot_number = NULL WHERE trolley_id = ?').run(trolley.code);
    db.prepare('DELETE FROM trace_alarms WHERE trolley_id = ?').run(id);
    // Bu arabayı işaret eden istasyon runtime kayıtlarını temizle
    db.prepare('UPDATE trace_station_runtime SET trolley_id = NULL WHERE trolley_id = ?').run(trolley.code);
    const res = db.prepare('DELETE FROM trolleys WHERE id = ?').run(id);
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
      `SELECT slot_number, shell_id AS product_id FROM shells
       WHERE trolley_id = ? AND slot_number IS NOT NULL ORDER BY slot_number`
    )
    .all(trolley.code) as { slot_number: number; product_id: string }[];
}

export function assignTrolleySlot(trolleyId: number, slotNumber: number, productId: string): void {
  const trolley = getTrolley(trolleyId);
  if (!trolley) return;
  const db = getDb();
  db.prepare(
    `UPDATE shells SET trolley_id = ?, slot_number = ?, updated_at = datetime('now') WHERE shell_id = ?`
  ).run(trolley.code, slotNumber, productId);
}

export function releaseTrolley(trolleyId: number): void {
  const trolley = getTrolley(trolleyId);
  if (!trolley) return;
  const db = getDb();
  db.prepare(
    "UPDATE shells SET trolley_id = NULL, slot_number = NULL, updated_at = datetime('now') WHERE trolley_id = ?"
  ).run(trolley.code);
}

export interface TrolleyProductItem {
  slotNumber: number;
  productId: string;
  status: string;
}

export function getTrolleyProductItems(trolleyId: number): TrolleyProductItem[] {
  const trolley = getTrolley(trolleyId);
  if (!trolley) return [];
  const db = getDb();
  const products = db
    .prepare('SELECT shell_id, status, slot_number FROM shells WHERE trolley_id = ? AND slot_number IS NOT NULL ORDER BY slot_number')
    .all(trolley.code) as { shell_id: string; status: string; slot_number: number }[];

  return products.map((p) => ({
    slotNumber: p.slot_number,
    productId: p.shell_id,
    status: p.status,
  }));
}

// ─── Ürünler ────────────────────────────────────────────────────────────────

const PRODUCT_SELECT =
  'SELECT id, shell_id AS product_id, status, qr_content, trolley_id AS trolley_code, slot_number, history, created_at, updated_at FROM shells';

export function generateProductId(date = new Date()): string {
  const db = getDb();
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  const prefix = `SH-${y}${m}${d}-`;
  const row = db
    .prepare(
      `SELECT shell_id AS product_id FROM shells WHERE shell_id LIKE ? ORDER BY shell_id DESC LIMIT 1`
    )
    .get(`${prefix}%`) as { product_id: string } | undefined;
  const seq = row ? Number(row.product_id.slice(prefix.length)) + 1 : 1;
  return `${prefix}${String(seq).padStart(4, '0')}`;
}

export function createProduct(input: { productId: string; qrContent?: string }): ProductRow {
  const db = getDb();
  const res = db
    .prepare(
      `INSERT INTO shells (shell_id, qr_content, history)
       VALUES (?, ?, '[]')`
    )
    .run(input.productId, input.qrContent ?? input.productId);
  return getProduct(Number(res.lastInsertRowid))!;
}

export function getProduct(id: number): ProductRow | undefined {
  const db = getDb();
  return db.prepare(`${PRODUCT_SELECT} WHERE id = ?`).get(id) as ProductRow | undefined;
}

export function getProductByProductId(productId: string): ProductRow | undefined {
  const db = getDb();
  return db.prepare(`${PRODUCT_SELECT} WHERE shell_id = ?`).get(productId) as ProductRow | undefined;
}

export function listProducts(opts: { status?: string; limit?: number } = {}): ProductRow[] {
  const db = getDb();
  const limit = Math.min(opts.limit ?? 200, 1000);
  if (opts.status) {
    return db
      .prepare(`${PRODUCT_SELECT} WHERE status = ? ORDER BY id DESC LIMIT ?`)
      .all(opts.status, limit) as ProductRow[];
  }
  return db.prepare(`${PRODUCT_SELECT} ORDER BY id DESC LIMIT ?`).all(limit) as ProductRow[];
}

export function setProductStatus(productId: string, status: 'in_progress' | 'completed' | 'rejected'): void {
  const db = getDb();
  db.prepare(
    "UPDATE shells SET status = ?, updated_at = datetime('now') WHERE shell_id = ?"
  ).run(status, productId);
}

export function deleteProduct(id: number): boolean {
  const db = getDb();
  const product = getProduct(id);
  if (!product) return false;

  const transaction = db.transaction(() => {
    db.prepare('DELETE FROM trace_alarms WHERE product_id = ?').run(product.product_id);
    db.prepare('DELETE FROM trace_measurements WHERE shell_id = ?').run(product.product_id);
    const res = db.prepare('DELETE FROM shells WHERE id = ?').run(id);
    return res.changes > 0;
  });

  return transaction();
}

// ─── İstasyon kayıtları (history JSON — olay günlüğü) ───────────────────────

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

  const nowStr = new Date().toISOString().replace('T', ' ').substring(0, 19);
  const newRecord = {
    id: history.length + 1,
    product_id: input.productId,
    shell_id: input.productId,
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

  db.prepare(
    `UPDATE shells SET history = ?, updated_at = datetime('now') WHERE shell_id = ?`
  ).run(JSON.stringify(history), input.productId);
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

/** İstasyonda ürün için belirli bir kayıt var mı */
export function hasRecord(productId: string, stationId: number, status?: string): boolean {
  const records = getProductRecords(productId);
  return records.some(
    (r) => (r.station_id === stationId || r.stationId === stationId) && (!status || r.status === status)
  );
}

// ─── Ölçümler (trace_measurements — düzenlenebilir/silinebilir) ─────────────

export interface MeasurementRow {
  id: number;
  shell_id: string;
  station_key: string;
  field: string;
  tag_id: number | null;
  value_num: number | null;
  value_text: string | null;
  source: 'plc' | 'manual';
  created_at: string;
  updated_at: string;
}

/**
 * Ölçüm yazar — (shell_id, station_key, field) tekil; tekrar tetiklemede
 * mevcut kaydın ÜZERİNE yazılır (UPSERT). Kaynak: 'plc' (trigger) veya
 * 'manual' (web arayüzünden girilen veri).
 */
export function upsertMeasurement(input: {
  shellId: string;
  stationKey: string;
  field: string;
  tagId?: number | null;
  value: number | string | boolean;
  source: 'plc' | 'manual';
}): void {
  const db = getDb();
  const num =
    typeof input.value === 'number' ? input.value
    : typeof input.value === 'boolean' ? (input.value ? 1 : 0)
    : null;
  const text = typeof input.value === 'number' ? null : String(input.value);
  db.prepare(
    `INSERT INTO trace_measurements (shell_id, station_key, field, tag_id, value_num, value_text, source, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))
     ON CONFLICT(shell_id, station_key, field)
     DO UPDATE SET value_num = excluded.value_num, value_text = excluded.value_text,
                   tag_id = excluded.tag_id, source = excluded.source, updated_at = datetime('now')`
  ).run(input.shellId, input.stationKey, input.field, input.tagId ?? null, num, text, input.source);
}

export function listMeasurements(shellId: string, stationKey?: string): MeasurementRow[] {
  const db = getDb();
  if (stationKey) {
    return db
      .prepare('SELECT * FROM trace_measurements WHERE shell_id = ? AND station_key = ? ORDER BY field')
      .all(shellId, stationKey) as MeasurementRow[];
  }
  return db
    .prepare('SELECT * FROM trace_measurements WHERE shell_id = ? ORDER BY station_key, field')
    .all(shellId) as MeasurementRow[];
}

/** Bir istasyonun en son yazdığı ölçümler (istasyon sayfasında "son ölçümler" listesi) */
export function listStationMeasurements(stationKey: string, limit = 20): MeasurementRow[] {
  const db = getDb();
  return db
    .prepare('SELECT * FROM trace_measurements WHERE station_key = ? ORDER BY updated_at DESC, id DESC LIMIT ?')
    .all(stationKey, Math.min(limit, 200)) as MeasurementRow[];
}

export function updateMeasurement(id: number, value: number | string): MeasurementRow | undefined {
  const db = getDb();
  const existing = db.prepare('SELECT * FROM trace_measurements WHERE id = ?').get(id) as MeasurementRow | undefined;
  if (!existing) return undefined;
  const num = typeof value === 'number' ? value : null;
  const text = typeof value === 'number' ? null : String(value);
  db.prepare(
    `UPDATE trace_measurements SET value_num = ?, value_text = ?, updated_at = datetime('now') WHERE id = ?`
  ).run(num, text, id);
  return db.prepare('SELECT * FROM trace_measurements WHERE id = ?').get(id) as MeasurementRow | undefined;
}

export function deleteMeasurement(id: number): MeasurementRow | undefined {
  const db = getDb();
  const existing = db.prepare('SELECT * FROM trace_measurements WHERE id = ?').get(id) as MeasurementRow | undefined;
  if (!existing) return undefined;
  db.prepare('DELETE FROM trace_measurements WHERE id = ?').run(id);
  return existing;
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
  return listProducts({ limit });
}

// ─── İstasyon çalışma durumu (trace_station_runtime — DB'de kalıcı) ─────────

/**
 * İstasyonun son okuduğu araba + son yakaladığı veri. Bellek-içi DEĞİL,
 * veritabanında tutulur — sunucu yeniden başlatılsa bile korunur.
 * Trolley Okuma istasyonunun yazdığı son araba, Trolley-Shell Eşleştirme
 * istasyonu tarafından okunur (getLastReadTrolleyCode).
 */
export interface LastCapture {
  at: string;                          // ISO zaman damgası
  summary: string;                     // örn. 'TR-001' veya 'SH-… / 4 ürün'
  data: Record<string, unknown>;       // alan adı → değer
  extra?: Record<string, unknown>;     // slot/satır vb. ek bilgi
}

export interface StationRuntime {
  station_id: number;
  trolley_id: string | null;
  last_capture: string | null; // JSON (LastCapture)
  updated_at: string;
}

export function getRuntime(stationId: number): StationRuntime {
  const db = getDb();
  const row = db.prepare('SELECT * FROM trace_station_runtime WHERE station_id = ?').get(stationId) as StationRuntime | undefined;
  return row ?? { station_id: stationId, trolley_id: null, last_capture: null, updated_at: '' };
}

export function getLastCapture(stationId: number): LastCapture | null {
  const rt = getRuntime(stationId);
  if (!rt.last_capture) return null;
  try {
    return JSON.parse(rt.last_capture) as LastCapture;
  } catch {
    return null;
  }
}

export function setRuntimeTrolley(stationId: number, trolleyCode: string | null): void {
  const db = getDb();
  db.prepare(
    `INSERT INTO trace_station_runtime (station_id, trolley_id, updated_at)
     VALUES (?, ?, datetime('now'))
     ON CONFLICT(station_id) DO UPDATE SET trolley_id = excluded.trolley_id, updated_at = datetime('now')`
  ).run(stationId, trolleyCode);
}

export function setRuntimeCapture(stationId: number, capture: LastCapture): void {
  const db = getDb();
  db.prepare(
    `INSERT INTO trace_station_runtime (station_id, last_capture, updated_at)
     VALUES (?, ?, datetime('now'))
     ON CONFLICT(station_id) DO UPDATE SET last_capture = excluded.last_capture, updated_at = datetime('now')`
  ).run(stationId, JSON.stringify(capture));
}

/**
 * Trolley Okuma istasyon(lar)ında en son okunan araba kodu.
 * Trolley-Shell Eşleştirme istasyonu arabayı buradan alır.
 */
export function getLastReadTrolleyCode(): string | null {
  const db = getDb();
  const row = db
    .prepare(
      `SELECT r.trolley_id FROM trace_station_runtime r
       JOIN trace_stations s ON s.id = r.station_id
       WHERE s.type = 'trolley_read' AND r.trolley_id IS NOT NULL AND s.is_active = 1
       ORDER BY r.updated_at DESC LIMIT 1`
    )
    .get() as { trolley_id: string } | undefined;
  return row?.trolley_id ?? null;
}

// ─── PLC tag yardımcıları ───────────────────────────────────────────────────

/** PLC tag adını çözer (ölçüm alan adı olarak kullanılır). */
export function getTagName(tagId: number): string | null {
  const db = getDb();
  const row = db.prepare('SELECT name FROM plc_tags WHERE id = ?').get(tagId) as { name: string } | undefined;
  return row?.name ?? null;
}
