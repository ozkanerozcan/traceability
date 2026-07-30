import { copyFileSync, existsSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { getDb, getDbPath } from '../../core/database/connection.js';
import { listCollectingWorkOrders } from '../work-order/work-order.service.js';

/**
 * DB Arşivleme (Faz 6):
 * 1. Interlock: active/paused iş emri varken arşivleme reddedilir.
 * 2. Aktif DB'nin TAM kopyası `mes_data_YYYY-MM-DD_HH-mm-ss.db` olarak alınır.
 * 3. Aktif DB'de YALNIZCA data_log temizlenir (konfigürasyon + iş emri geçmişi korunur).
 */

export interface ArchiveResult {
  archivePath: string;
  deletedRows: number;
}

export function getDbSizeBytes(): number {
  const path = getDbPath();
  return existsSync(path) ? statSync(path).size : 0;
}

export function archiveDatabase(): ArchiveResult {
  // ─── Interlock ───
  const collecting = listCollectingWorkOrders();
  if (collecting.length > 0) {
    const err = new Error(
      `Aktif/duraklatılmış ${collecting.length} iş emri varken arşivleme yapılamaz — önce iş emirlerini tamamlayın`
    );
    (err as Error & { code: string }).code = 'WORK_ORDER_ACTIVE';
    throw err;
  }

  const dbPath = getDbPath();
  // mes_data_2026-07-30_04-16-45.db
  const stamp = new Date().toISOString().slice(0, 19).replace('T', '_').replace(/:/g, '-');
  const archivePath = join(dirname(dbPath), `mes_data_${stamp}.db`);

  // WAL checkpoint sonrası tutarlı kopya
  const db = getDb();
  db.pragma('wal_checkpoint(TRUNCATE)');
  copyFileSync(dbPath, archivePath);

  // Yalnızca data_log temizlenir
  const before = (db.prepare('SELECT COUNT(*) AS c FROM data_log').get() as { c: number }).c;
  db.exec('DELETE FROM data_log');
  db.pragma('wal_checkpoint(TRUNCATE)');

  return { archivePath, deletedRows: before };
}
