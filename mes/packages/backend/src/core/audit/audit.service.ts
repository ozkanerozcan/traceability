import { getDb } from '../database/connection.js';
import type { AuditLogEntry } from '../../shared/types/index.js';

/**
 * Audit trail kaydı ekler. Tüm önemli sistem olayları (login, CRUD, start/stop)
 * bu servis üzerinden kayıt altına alınır.
 */
export function writeAudit(entry: AuditLogEntry): void {
  const db = getDb();
  db.prepare(
    `INSERT INTO audit_log (user_id, username, action, entity_type, entity_id, details, ip_address)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(
    entry.userId ?? null,
    entry.username ?? null,
    entry.action,
    entry.entityType ?? null,
    entry.entityId ?? null,
    entry.details !== undefined ? JSON.stringify(entry.details) : null,
    entry.ipAddress ?? null
  );
}

export interface AuditQuery {
  limit?: number;
  offset?: number;
  userId?: number;
  action?: string;
  entityType?: string;
  from?: string;
  to?: string;
}

export function queryAuditLog(q: AuditQuery) {
  const db = getDb();
  const where: string[] = [];
  const values: unknown[] = [];

  if (q.userId !== undefined) {
    where.push('user_id = ?');
    values.push(q.userId);
  }
  if (q.action) {
    where.push('action = ?');
    values.push(q.action);
  }
  if (q.entityType) {
    where.push('entity_type = ?');
    values.push(q.entityType);
  }
  if (q.from) {
    where.push('created_at >= ?');
    values.push(q.from);
  }
  if (q.to) {
    where.push('created_at <= ?');
    values.push(q.to);
  }

  const whereSql = where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';
  const limit = Math.min(q.limit ?? 100, 1000);
  const offset = q.offset ?? 0;

  const rows = db
    .prepare(
      `SELECT * FROM audit_log ${whereSql} ORDER BY id DESC LIMIT ? OFFSET ?`
    )
    .all(...values, limit, offset);

  const total = (
    db.prepare(`SELECT COUNT(*) AS c FROM audit_log ${whereSql}`).get(...values) as {
      c: number;
    }
  ).c;

  return { rows, total, limit, offset };
}