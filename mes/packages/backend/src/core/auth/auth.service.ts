import bcrypt from 'bcryptjs';
import { getDb } from '../database/connection.js';
import type { Role, SafeUser, UserRow } from '../../shared/types/index.js';

function toSafeUser(row: UserRow): SafeUser {
  return {
    id: row.id,
    username: row.username,
    role: row.role,
    displayName: row.display_name,
    language: row.language,
    theme: row.theme,
    isActive: row.is_active === 1,
  };
}

export function findUserByUsername(username: string): UserRow | undefined {
  const db = getDb();
  return db.prepare('SELECT * FROM users WHERE username = ?').get(username) as
    | UserRow
    | undefined;
}

export function findUserById(id: number): UserRow | undefined {
  const db = getDb();
  return db.prepare('SELECT * FROM users WHERE id = ?').get(id) as UserRow | undefined;
}

export function verifyPassword(plain: string, hash: string): boolean {
  return bcrypt.compareSync(plain, hash);
}

export function hashPassword(plain: string): string {
  return bcrypt.hashSync(plain, 10);
}

/**
 * Kimlik doğrulama. Başarılıysa SafeUser döner, değilse null.
 */
export function authenticate(username: string, password: string): SafeUser | null {
  const user = findUserByUsername(username);
  if (!user) return null;
  if (user.is_active !== 1) return null;
  if (!verifyPassword(password, user.password_hash)) return null;
  return toSafeUser(user);
}

export function getSafeUserById(id: number): SafeUser | null {
  const user = findUserById(id);
  if (!user || user.is_active !== 1) return null;
  return toSafeUser(user);
}

export function updateUserPreferences(
  id: number,
  prefs: { language?: string; theme?: string }
): void {
  const db = getDb();
  const sets: string[] = [];
  const values: unknown[] = [];

  if (prefs.language !== undefined) {
    sets.push('language = ?');
    values.push(prefs.language);
  }
  if (prefs.theme !== undefined) {
    sets.push('theme = ?');
    values.push(prefs.theme);
  }
  if (sets.length === 0) return;

  sets.push("updated_at = datetime('now')");
  values.push(id);

  db.prepare(`UPDATE users SET ${sets.join(', ')} WHERE id = ?`).run(...values);
}

export function changePassword(id: number, newPassword: string): void {
  const db = getDb();
  db.prepare(
    "UPDATE users SET password_hash = ?, updated_at = datetime('now') WHERE id = ?"
  ).run(hashPassword(newPassword), id);
}

export function isValidRole(role: string): role is Role {
  return role === 'admin' || role === 'supervisor' || role === 'operator';
}