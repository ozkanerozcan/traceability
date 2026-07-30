import { getDb } from '../../core/database/connection.js';

// ─── Tipler ─────────────────────────────────────────────────────────────────

export const WO_STATUSES = ['draft', 'active', 'paused', 'completed', 'archived'] as const;
export type WorkOrderStatus = (typeof WO_STATUSES)[number];

export interface WorkOrderRow {
  id: number;
  order_number: string;
  recipe_id: number;
  status: WorkOrderStatus;
  started_at: string | null;
  paused_at: string | null;
  completed_at: string | null;
  created_by: number | null;
  started_by: number | null;
  completed_by: number | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface WorkOrderInput {
  recipeId: number;
  notes?: string | null;
}

export interface WorkOrderFilters {
  status?: WorkOrderStatus;
  recipeId?: number;
}

/** İzin verilen durum geçişleri: from → [to...] */
const TRANSITIONS: Record<WorkOrderStatus, WorkOrderStatus[]> = {
  draft: ['active'],
  active: ['paused', 'completed'],
  paused: ['active', 'completed'],
  completed: ['archived'],
  archived: [],
};

export function canTransition(from: WorkOrderStatus, to: WorkOrderStatus): boolean {
  return TRANSITIONS[from]?.includes(to) ?? false;
}

/** Veri toplamaya dahil olan durumlar (DataCollector bunlara yazar) */
export const COLLECTING_STATUSES: WorkOrderStatus[] = ['active', 'paused'];

// ─── Numara Üretimi ─────────────────────────────────────────────────────────

/** WO-YYYYMMDD-NNN — gün bazında artan sıra numarası */
export function generateOrderNumber(date = new Date()): string {
  const db = getDb();
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  const prefix = `WO-${y}${m}${d}-`;
  const row = db
    .prepare(
      `SELECT order_number FROM work_orders
       WHERE order_number LIKE ? ORDER BY order_number DESC LIMIT 1`
    )
    .get(`${prefix}%`) as { order_number: string } | undefined;
  const seq = row ? Number(row.order_number.slice(prefix.length)) + 1 : 1;
  return `${prefix}${String(seq).padStart(3, '0')}`;
}

// ─── Sorgular ───────────────────────────────────────────────────────────────

export function listWorkOrders(filters: WorkOrderFilters = {}): WorkOrderRow[] {
  const db = getDb();
  const where: string[] = [];
  const values: unknown[] = [];
  if (filters.status) {
    where.push('status = ?');
    values.push(filters.status);
  }
  if (filters.recipeId) {
    where.push('recipe_id = ?');
    values.push(filters.recipeId);
  }
  const whereSql = where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';
  return db
    .prepare(`SELECT * FROM work_orders ${whereSql} ORDER BY id DESC`)
    .all(...values) as WorkOrderRow[];
}

export function getWorkOrder(id: number): WorkOrderRow | undefined {
  const db = getDb();
  return db.prepare('SELECT * FROM work_orders WHERE id = ?').get(id) as
    | WorkOrderRow
    | undefined;
}

/** Veri toplayan (active/paused) iş emirleri — DataCollector resume için */
export function listCollectingWorkOrders(): WorkOrderRow[] {
  const db = getDb();
  return db
    .prepare("SELECT * FROM work_orders WHERE status IN ('active', 'paused')")
    .all() as WorkOrderRow[];
}

// ─── Komutlar ───────────────────────────────────────────────────────────────

export function createWorkOrder(input: WorkOrderInput, userId: number): WorkOrderRow {
  const db = getDb();
  const orderNumber = generateOrderNumber();
  const result = db
    .prepare(
      `INSERT INTO work_orders (order_number, recipe_id, status, notes, created_by)
       VALUES (?, ?, 'draft', ?, ?)`
    )
    .run(orderNumber, input.recipeId, input.notes ?? null, userId);
  return getWorkOrder(Number(result.lastInsertRowid))!;
}

export function updateWorkOrderNotes(id: number, notes: string | null): WorkOrderRow | undefined {
  const db = getDb();
  db.prepare("UPDATE work_orders SET notes = ?, updated_at = datetime('now') WHERE id = ?").run(
    notes,
    id
  );
  return getWorkOrder(id);
}

/** Durum geçişi — çağıran canTransition kontrolünü yapmış olmalı */
export function transitionWorkOrder(
  id: number,
  to: WorkOrderStatus,
  userId: number
): WorkOrderRow | undefined {
  const db = getDb();
  const now = "datetime('now')";
  let sql: string;
  const params: unknown[] = [to];

  switch (to) {
    case 'active':
      // Başlat veya sürdür — started_at yalnız ilk başlatmada set edilir
      sql = `UPDATE work_orders SET status = ?,
               started_at = COALESCE(started_at, ${now}),
               started_by = COALESCE(started_by, ?),
               paused_at = NULL,
               updated_at = ${now}
             WHERE id = ?`;
      params.push(userId, id);
      break;
    case 'paused':
      sql = `UPDATE work_orders SET status = ?, paused_at = ${now}, updated_at = ${now}
             WHERE id = ?`;
      params.push(id);
      break;
    case 'completed':
      sql = `UPDATE work_orders SET status = ?, completed_at = ${now}, completed_by = ?,
               updated_at = ${now}
             WHERE id = ?`;
      params.push(userId, id);
      break;
    case 'archived':
      sql = `UPDATE work_orders SET status = ?, updated_at = ${now} WHERE id = ?`;
      params.push(id);
      break;
    default:
      return undefined;
  }

  db.prepare(sql).run(...params);
  return getWorkOrder(id);
}

/** Yalnız draft iş emirleri silinebilir */
export function deleteWorkOrder(id: number): boolean {
  const db = getDb();
  const result = db.prepare("DELETE FROM work_orders WHERE id = ? AND status = 'draft'").run(id);
  return result.changes > 0;
}

// ─── Veri Sorgusu (zaman serisi) ────────────────────────────────────────────

export interface DataLogRow {
  id: number;
  timestamp: string;
  work_order_id: number;
  tag_id: number;
  value: number | null;
  value_text: string | null;
  quality: string;
}

export function getWorkOrderData(
  workOrderId: number,
  opts: { tagIds?: number[]; limit?: number } = {}
): DataLogRow[] {
  const db = getDb();
  const limit = Math.min(opts.limit ?? 5000, 20000);
  let sql = `SELECT * FROM data_log WHERE work_order_id = ?`;
  const values: unknown[] = [workOrderId];
  if (opts.tagIds && opts.tagIds.length > 0) {
    sql += ` AND tag_id IN (${opts.tagIds.map(() => '?').join(',')})`;
    values.push(...opts.tagIds);
  }
  sql += ` ORDER BY timestamp ASC, id ASC LIMIT ?`;
  values.push(limit);
  return db.prepare(sql).all(...values) as DataLogRow[];
}
