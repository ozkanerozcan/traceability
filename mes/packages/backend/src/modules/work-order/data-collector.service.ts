import { getDb } from '../../core/database/connection.js';
import { workerManager } from '../plc-gateway/workers/worker.manager.js';
import type { TagValue } from '../plc-gateway/plc.types.js';
import { COLLECTING_STATUSES, listCollectingWorkOrders, type WorkOrderStatus } from './work-order.service.js';

/**
 * DataCollector (Faz 4): worker'lardan gelen canlı tag değerlerini, durumu
 * 'active' veya 'paused' olan iş emirlerinin reçetelerindeki tag'lerle
 * eşleştirir ve data_log tablosuna yazar.
 *
 * - Transaction batching: 1 sn'de biriken kayıtlar tek BEGIN...COMMIT ile yazılır.
 * - quality='bad' değerler value=NULL + quality='bad' olarak kaydedilir.
 * - STRING tipli tag'ler value_text kolonuna yazılır.
 * - Sunucu yeniden başladığında active/paused iş emirleri için otomatik devam eder.
 */

interface BufferedRow {
  ts: string;
  workOrderId: number;
  tagId: number;
  value: number | null;
  valueText: string | null;
  quality: string;
}

const FLUSH_INTERVAL_MS = 1000;

class DataCollectorService {
  private active = new Map<number, Set<number>>(); // workOrderId → tagId seti
  private buffer: BufferedRow[] = [];
  private flushTimer: NodeJS.Timeout | null = null;
  private flushing = false;

  /** Boot'ta + her iş emri durum değişiminde toplama setini tazeler. */
  refresh(): void {
    const db = getDb();
    const collecting = listCollectingWorkOrders();

    this.active.clear();
    for (const wo of collecting) {
      // İş emrinin reçetesindeki dashboard widget'larına bağlı tag'leri bul
      const rows = db
        .prepare(
          `SELECT DISTINCT rt.tag_id FROM recipe_tags rt WHERE rt.recipe_id = ?
           UNION
           SELECT DISTINCT rt2.tag_id FROM recipe_tags rt2
             JOIN recipes r ON r.id = rt2.recipe_id WHERE r.id = ?`
        )
        .all(wo.recipe_id, wo.recipe_id) as { tag_id: number }[];

      // dashboard_layout JSON içindeki tagId/tagIds bağlantılarını da dahil et
      const tagIds = new Set<number>(rows.map((r) => r.tag_id));
      const recipe = db
        .prepare('SELECT dashboard_layout FROM recipes WHERE id = ?')
        .get(wo.recipe_id) as { dashboard_layout: string | null } | undefined;

      if (recipe?.dashboard_layout) {
        try {
          const layout = JSON.parse(recipe.dashboard_layout) as {
            widgets?: { tagId?: number | null; tagIds?: number[] }[];
          };
          for (const w of layout.widgets ?? []) {
            if (typeof w.tagId === 'number') tagIds.add(w.tagId);
            for (const id of w.tagIds ?? []) tagIds.add(id);
          }
        } catch {
          // Bozuk layout JSON'u yok sayılır
        }
      }

      this.active.set(wo.id, tagIds);
    }
  }

  /** WorkerManager veri akışına abone olur (bir kez, modül register'da). */
  start(): void {
    workerManager.onData((plcId, values) => this.onPlcData(plcId, values));
    this.refresh();
    this.flushTimer = setInterval(() => this.flush(), FLUSH_INTERVAL_MS);
    this.flushTimer.unref?.();
    console.log(`[data-collector] Başlatıldı — ${this.active.size} iş emri için veri toplanıyor`);
  }

  stop(): void {
    if (this.flushTimer) {
      clearInterval(this.flushTimer);
      this.flushTimer = null;
    }
    this.flush();
  }

  /** İş emri durum değişiminde routes tarafından çağrılır. */
  onStatusChanged(workOrderId: number, status: WorkOrderStatus): void {
    if ((COLLECTING_STATUSES as string[]).includes(status)) {
      this.refresh();
    } else {
      this.active.delete(workOrderId);
      this.flush(); // Kalan kayıtları hemen yaz
    }
  }

  private onPlcData(_plcId: number, values: TagValue[]): void {
    if (this.active.size === 0) return;
    const ts = new Date().toISOString();
    for (const [workOrderId, tagIds] of this.active) {
      for (const tv of values) {
        if (!tagIds.has(tv.tagId)) continue;
        const quality = tv.quality ?? 'good';
        const isBad = quality === 'bad';
        const isText = typeof tv.value === 'string';
        this.buffer.push({
          ts: tv.timestamp ?? ts,
          workOrderId,
          tagId: tv.tagId,
          value: isBad || tv.value === null || isText ? null : Number(tv.value),
          valueText: isBad ? null : isText ? String(tv.value) : null,
          quality,
        });
      }
    }
  }

  private flush(): void {
    if (this.flushing || this.buffer.length === 0) return;
    this.flushing = true;
    const rows = this.buffer;
    this.buffer = [];
    try {
      const db = getDb();
      const insert = db.prepare(
        `INSERT INTO data_log (timestamp, work_order_id, tag_id, value, value_text, quality)
         VALUES (?, ?, ?, ?, ?, ?)`
      );
      const tx = db.transaction((batch: BufferedRow[]) => {
        for (const r of batch) {
          insert.run(r.ts, r.workOrderId, r.tagId, r.value, r.valueText, r.quality);
        }
      });
      tx(rows);
    } catch (err) {
      console.error('[data-collector] Yazma hatası:', err);
    } finally {
      this.flushing = false;
    }
  }

  /** Toplama yapılan iş emri sayısı (health/debug). */
  get activeCount(): number {
    return this.active.size;
  }
}

export const dataCollector = new DataCollectorService();
