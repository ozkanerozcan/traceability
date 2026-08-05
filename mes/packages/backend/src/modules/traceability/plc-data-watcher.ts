import { workerManager } from '../plc-gateway/workers/worker.manager.js';
import type { TagValue } from '../plc-gateway/plc.types.js';
import { handleStationTrigger } from './station.engine.js';
import { listStations, parseConfig, PLC_STATION_TYPES, type StationType } from './trace.service.js';

/**
 * PLC Trigger İzleyici.
 *
 * PLC'li tüm istasyonların (trolley_read, funnel_screwing,
 * trolley_shell_matching, filling, probing) config'indeki trigger bitini
 * (triggerTagId) canlı PLC veri akışında (workerManager.onData) izler.
 * Bit false→true (yükselen kenar) olunca handleStationTrigger çağrılır —
 * standart sözleşme tag'leri okunur, istasyon tipine göre işlenir, sonuç
 * (Ack/ErrorCode/ErrorMessage/Busy) PLC'ye yazılır ve trigger false'a
 * çekilir (handshake).
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
    if (!PLC_STATION_TYPES.includes(station.type as StationType)) continue;
    const cfg = parseConfig(station.config);
    if (!cfg.plcId || !cfg.triggerTagId) continue;
    next.push({ stationId: station.id, plcId: cfg.plcId, triggerTagId: cfg.triggerTagId });
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
      // Yükselen kenar → istasyonu tetikle
      handleStationTrigger(w.stationId, { source: 'plc' }).catch((err) => {
        console.error(`[plc-data-watcher] trigger hatası (istasyon ${w.stationId}):`, err);
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
