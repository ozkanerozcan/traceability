import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { DEFAULT_DB_PATH } from '../../shared/constants/index.js';

let db: Database.Database | null = null;

export function getDbPath(): string {
  return resolve(process.env.DB_PATH ?? DEFAULT_DB_PATH);
}

/**
 * SQLite bağlantısını açar (singleton).
 * WAL modu + performans pragmaları ile yapılandırılır.
 */
export function getDb(): Database.Database {
  if (db) return db;

  const dbPath = getDbPath();
  mkdirSync(dirname(dbPath), { recursive: true });

  db = new Database(dbPath);

  // WAL modu: okuma/yazma eşzamanlılığı
  db.pragma('journal_mode = WAL');
  // Veri bütünlüğü / performans dengesi
  db.pragma('synchronous = NORMAL');
  // Foreign key zorunluluğu
  db.pragma('foreign_keys = ON');
  // Büyük zaman serisi verileri için geniş cache (64 MB)
  db.pragma('cache_size = -64000');
  // Temp tabloları bellekte
  db.pragma('temp_store = MEMORY');
  // Otomatik alan geri kazanımı
  db.pragma('auto_vacuum = INCREMENTAL');

  return db;
}

/** Bağlantıyı kapatır (graceful shutdown). */
export function closeDb(): void {
  if (db) {
    db.close();
    db = null;
  }
}