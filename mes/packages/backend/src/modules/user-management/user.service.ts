import bcrypt from 'bcryptjs';
import { getDb } from '../../core/database/connection.js';
import type { Role, UserRow } from '../../shared/types/index.js';

// ─── Tipler ─────────────────────────────────────────────────────────────────

export interface UserInput {
  username: string;
  password?: string;
  role: Role;
  displayName?: string | null;
  isActive?: boolean;
}

export interface PermissionRow {
  id: number;
  role: string;
  module_id: string;
  permission: string;
  granted: number;
}

export const PERMISSIONS = ['view', 'create', 'edit', 'delete', 'manage'] as const;

// ─── Sorgular ───────────────────────────────────────────────────────────────

export function listUsers(): Omit<UserRow, 'password_hash'>[] {
  const db = getDb();
  return db
    .prepare(
      `SELECT id, username, role, display_name, language, theme, is_active, created_at, updated_at
       FROM users ORDER BY username`
    )
    .all() as Omit<UserRow, 'password_hash'>[];
}

export function getUser(id: number): UserRow | undefined {
  const db = getDb();
  return db.prepare('SELECT * FROM users WHERE id = ?').get(id) as UserRow | undefined;
}

export function getUserByUsername(username: string): UserRow | undefined {
  const db = getDb();
  return db.prepare('SELECT * FROM users WHERE username = ?').get(username) as UserRow | undefined;
}

// ─── Komutlar ───────────────────────────────────────────────────────────────

export function createUser(input: UserInput): Omit<UserRow, 'password_hash'> {
  const db = getDb();
  if (!input.password || input.password.length < 4) {
    throw new Error('VALIDATION: Şifre en az 4 karakter olmalıdır');
  }
  const hash = bcrypt.hashSync(input.password, 10);
  const result = db
    .prepare(
      `INSERT INTO users (username, password_hash, role, display_name, is_active, must_change_password)
       VALUES (?, ?, ?, ?, ?, 1)`
    )
    .run(input.username, hash, input.role, input.displayName ?? null, input.isActive === false ? 0 : 1);
  return sanitize(getUser(Number(result.lastInsertRowid))!);
}

export function updateUser(id: number, input: Partial<UserInput>): Omit<UserRow, 'password_hash'> | undefined {
  const db = getDb();
  const existing = getUser(id);
  if (!existing) return undefined;

  db.prepare(
    `UPDATE users SET role = ?, display_name = ?, is_active = ?, updated_at = datetime('now')
     WHERE id = ?`
  ).run(
    input.role ?? existing.role,
    input.displayName !== undefined ? input.displayName : existing.display_name,
    input.isActive === undefined ? existing.is_active : input.isActive ? 1 : 0,
    id
  );

  if (input.password && input.password.length > 0) {
    const hash = bcrypt.hashSync(input.password, 10);
    db.prepare(
      "UPDATE users SET password_hash = ?, must_change_password = 1, updated_at = datetime('now') WHERE id = ?"
    ).run(hash, id);
  }

  return sanitize(getUser(id)!);
}

export function deleteUser(id: number): boolean {
  const db = getDb();
  const result = db.prepare('DELETE FROM users WHERE id = ?').run(id);
  return result.changes > 0;
}

export function countAdmins(): number {
  const db = getDb();
  return (db.prepare("SELECT COUNT(*) AS c FROM users WHERE role = 'admin'").get() as { c: number }).c;
}

function sanitize(row: UserRow): Omit<UserRow, 'password_hash'> {
  const { password_hash: _ignored, ...rest } = row;
  return rest;
}

// ─── Yetkiler ───────────────────────────────────────────────────────────────

export function listPermissions(): PermissionRow[] {
  const db = getDb();
  return db.prepare('SELECT * FROM role_permissions ORDER BY role, module_id, permission').all() as PermissionRow[];
}

export function setPermission(role: string, moduleId: string, permission: string, granted: boolean): void {
  const db = getDb();
  db.prepare(
    `INSERT INTO role_permissions (role, module_id, permission, granted)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(role, module_id, permission) DO UPDATE SET granted = excluded.granted`
  ).run(role, moduleId, permission, granted ? 1 : 0);
}

export function hasPermission(role: string, moduleId: string, permission: string): boolean {
  const db = getDb();
  const row = db
    .prepare('SELECT granted FROM role_permissions WHERE role = ? AND module_id = ? AND permission = ?')
    .get(role, moduleId, permission) as { granted: number } | undefined;
  return row?.granted === 1;
}
