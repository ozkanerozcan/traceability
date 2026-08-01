import { workerManager } from '../plc-gateway/workers/worker.manager.js';
import type { TagValue } from '../plc-gateway/plc.types.js';
import { capturePlcData } from './station.engine.js';
import { listStations, parseCapabilities, parseConfig } from './trace.service.js';

/**
 * PLC Data Tetikleyici İzleyici (plc_acquire).
 *
 * Her istasyonun config'indeki trigger bitini (triggerTagId) canlı PLC veri
 * akışında (workerManager.onData) izler. Bit false→true (yükselen kenar)
 * olunca capturePlcData çağrılır — seçili data tag'leri istasyonun AKTİF
 * ürününe yazılır.
 *
 * İzleme, worker'ın mevcut subscription/poll akışını kullanır; ayrıca bir
 * polling döngüsü GEREKMEZ. OPC UA subscribe modunda trigger tag'i yalnızca
 * değiştiğinde bildirilir — bu da tam olarak kenar tespiti sağlar.
 */

interface TriggerWatch {
  stationId: number;
  plcId: number;
  triggerTagId: number;
}

let watches: TriggerWatch[] = [];
const lastTriggerState = new Map<number, boolean>();
let started = false;

function toBool(v: number | boolean | string | null): boolean {
  if (v === null || v === undefined) return false;
  if (typeof v === 'boolean') return v;
  if (typeof v === 'number') return v !== 0;
  return v === 'true' || v === '1';
}

/** İstasyon config'lerinden trigger izleme listesini yeniden kurar. */
export function reloadPlcDataWatches(): void {
  const next: TriggerWatch[] = [];
  for (const station of listStations()) {
    if (station.is_active !== 1) continue;
    const caps = parseCapabilities(station.capabilities);
    if (!caps.includes('plc_acquire')) continue;
    const cfg = parseConfig(station.config);
    if (cfg.plcId && cfg.triggerTagId && cfg.dataTagIds && cfg.dataTagIds.length > 0) {
      next.push({ stationId: station.id, plcId: cfg.plcId, triggerTagId: cfg.triggerTagId });
    }
  }
  watches = next;
  // Artık izlenmeyen istasyonların kenar durumunu temizle
  const ids = new Set(next.map((w) => w.stationId));
  for (const key of [...lastTriggerState.keys()]) {
    if (!ids.has(key)) lastTriggerState.delete(key);
  }
}

function handleData(plcId: number, values: TagValue[]): void {
  for (const w of watches) {
    if (w.plcId !== plcId) continue;
    const tv = values.find((v) => v.tagId === w.triggerTagId);
    if (!tv) continue;
    const bool = toBool(tv.value);
    const prev = lastTriggerState.get(w.stationId) ?? false;
    lastTriggerState.set(w.stationId, bool);
    if (bool && !prev) {
      // Yükselen kenar → veriyi AKTİF ürüne yaz
      capturePlcData(w.stationId).catch((err) => {
        console.error(`[plc-data-watcher] capture hatası (istasyon ${w.stationId}):`, err);
      });
    }
  }
}

/** Modül register'da bir kez çağrılır. */
export function startPlcDataWatcher(): void {
  if (started) return;
  started = true;
  reloadPlcDataWatches();
  workerManager.onData((plcId, values) => {
    try {
      handleData(plcId, values);
    } catch (err) {
      console.error('[plc-data-watcher] hata:', err);
    }
  });
}
