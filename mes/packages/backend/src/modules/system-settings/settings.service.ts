import { getDb } from '../../core/database/connection.js';
import type { ModuleRow, SystemSettingRow } from '../../shared/types/index.js';

// ─── Sistem Ayarları (key-value) ────────────────────────────────────────────

export function listSettings(): SystemSettingRow[] {
  const db = getDb();
  return db.prepare('SELECT * FROM system_settings ORDER BY category, key').all() as SystemSettingRow[];
}

export function getSetting(key: string): string | undefined {
  const db = getDb();
  const row = db.prepare('SELECT value FROM system_settings WHERE key = ?').get(key) as
    | { value: string }
    | undefined;
  return row?.value;
}

export function setSetting(key: string, value: string, category = 'general'): void {
  const db = getDb();
  db.prepare(
    `INSERT INTO system_settings (key, value, category, updated_at)
     VALUES (?, ?, ?, datetime('now'))
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')`
  ).run(key, value, category);
}

// ─── Modül Durumları ────────────────────────────────────────────────────────

export function listModules(): ModuleRow[] {
  const db = getDb();
  return db.prepare('SELECT * FROM modules ORDER BY id').all() as ModuleRow[];
}

export function setModuleEnabled(id: string, enabled: boolean): boolean {
  const db = getDb();
  const result = db
    .prepare("UPDATE modules SET enabled = ?, updated_at = datetime('now') WHERE id = ?")
    .run(enabled ? 1 : 0, id);
  return result.changes > 0;
}
