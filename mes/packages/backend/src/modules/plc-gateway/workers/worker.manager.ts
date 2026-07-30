import { Worker } from 'node:worker_threads';
import { join } from 'node:path';
import { getDb } from '../../../core/database/connection.js';
import { wsManager } from '../../../core/websocket/ws.manager.js';
import { decryptSecret } from '../../../core/crypto/secret.service.js';
import type {
  PlcProfileRow,
  PlcStatus,
  PlcTagRow,
  TagConfig,
  TagValue,
  WorkerCommand,
  WorkerEvent,
  WorkerInitData,
} from '../plc.types.js';

const REQUEST_TIMEOUT_MS = 8000;

interface PendingRequest {
  resolve: (value: number | boolean | string | null) => void;
  reject: (err: Error) => void;
  timer: NodeJS.Timeout;
  isWrite: boolean;
}

interface ManagedWorker {
  worker: Worker;
  status: PlcStatus;
  statusMessage?: string;
  lastValues: Map<number, TagValue>;
  pending: Map<number, PendingRequest>;
}

/** Veri kaydı (Faz 4 DataCollector) için callback kaydı. */
type DataListener = (plcId: number, values: TagValue[]) => void;

/**
 * WorkerManager: her PLC için bir worker thread yönetir.
 * - Otomatik başlatma (is_active PLC'ler server boot'ta)
 * - Canlı veri → WebSocket broadcast + data listener'lar
 * - Manuel read/write → request/response korelasyonu
 */
class WorkerManager {
  private workers = new Map<number, ManagedWorker>();
  private requestCounter = 0;
  private dataListeners: DataListener[] = [];

  /** Faz 4'te DataCollector bu metodla abone olur. */
  onData(listener: DataListener): void {
    this.dataListeners.push(listener);
  }

  /** DB satırını worker konfigürasyonuna çevirir. */
  private buildInitData(plc: PlcProfileRow, tagRows: PlcTagRow[]): WorkerInitData {
    const tags: TagConfig[] = tagRows
      .filter((t) => t.is_active === 1)
      .map((t) => ({
        id: t.id,
        name: t.name,
        address: t.address,
        registerType: t.register_type,
        dataType: t.data_type,
        acquisitionMode: t.acquisition_mode,
        pollingIntervalMs: t.polling_interval_ms,
        unit: t.unit,
        wordSwap: t.word_swap === 1,
        byteSwap: t.byte_swap === 1,
      }));

    return {
      plcId: plc.id,
      connection: buildConnectionConfig(plc),
      tags,
    };
  }

  private loadInitData(plcId: number): WorkerInitData | null {
    const db = getDb();
    const plc = db.prepare('SELECT * FROM plc_profiles WHERE id = ?').get(plcId) as
      | PlcProfileRow
      | undefined;
    if (!plc) return null;
    const tagRows = db.prepare('SELECT * FROM plc_tags WHERE plc_id = ?').all(plcId) as PlcTagRow[];
    return this.buildInitData(plc, tagRows);
  }

  /** PLC için worker thread başlatır. Zaten çalışıyorsa no-op. */
  async start(plcId: number): Promise<void> {
    if (this.workers.has(plcId)) return;

    const initData = this.loadInitData(plcId);
    if (!initData) {
      throw new Error(`PLC bulunamadı: ${plcId}`);
    }

    // Geliştirme (tsx) ortamında .ts worker dosyası + loader argümanları,
    // production'da derlenmiş .js dosyası kullanılır.
    const isTsRuntime = __filename.endsWith('.ts');
    const workerPath = join(__dirname, isTsRuntime ? 'plc.worker.ts' : 'plc.worker.js');

    const worker = new Worker(workerPath, {
      workerData: initData,
      execArgv: isTsRuntime ? process.execArgv : [],
    });

    const managed: ManagedWorker = {
      worker,
      status: 'connecting',
      lastValues: new Map(),
      pending: new Map(),
    };
    this.workers.set(plcId, managed);

    worker.on('message', (msg: WorkerEvent) => this.handleWorkerMessage(plcId, msg));
    worker.on('error', (err) => {
      console.error(`[worker-manager] Worker hatası (PLC ${plcId}):`, err);
      this.handleWorkerExit(plcId, 1);
    });
    worker.on('exit', (code) => this.handleWorkerExit(plcId, code));

    this.setStatus(plcId, 'connecting');
  }

  /** Worker'ı nazikçe durdurur (stop komutu + terminate). */
  async stop(plcId: number): Promise<void> {
    const managed = this.workers.get(plcId);
    if (!managed) return;

    this.sendCommand(plcId, { cmd: 'stop' });

    // Nazik kapanış için kısa süre bekle, sonra zorla sonlandır
    await Promise.race([
      managed.worker.terminate(),
      new Promise<void>((resolve) => setTimeout(resolve, 3000)),
    ]);

    this.cleanup(plcId);
    this.setStatus(plcId, 'stopped');
  }

  /** Tüm worker'ları durdurur (graceful shutdown). */
  async stopAll(): Promise<void> {
    const ids = [...this.workers.keys()];
    await Promise.all(ids.map((id) => this.stop(id)));
  }

  /** is_active=1 olan tüm PLC'leri başlatır (server boot). */
  async startAllActive(): Promise<void> {
    const db = getDb();
    const rows = db.prepare('SELECT id FROM plc_profiles WHERE is_active = 1').all() as {
      id: number;
    }[];
    for (const row of rows) {
      try {
        await this.start(row.id);
      } catch (err) {
        console.error(`[worker-manager] Otomatik başlatma hatası (PLC ${row.id}):`, err);
      }
    }
  }

  /** Tag listesi değiştiğinde çalışan worker'a yeni listeyi iletir. */
  updateTags(plcId: number): void {
    const initData = this.loadInitData(plcId);
    if (!initData) return;
    this.sendCommand(plcId, { cmd: 'updateTags', tags: initData.tags });
  }

  /** Manuel tag okuma — worker çevrimiçi olmalı. */
  readTag(plcId: number, tagId: number): Promise<number | boolean | string | null> {
    return this.sendRequest(plcId, tagId, false);
  }

  /** Manuel tag yazma — worker çevrimiçi olmalı. */
  writeTag(plcId: number, tagId: number, value: number | boolean | string): Promise<void> {
    return this.sendRequest(plcId, tagId, true, value).then(() => undefined);
  }

  private sendRequest(
    plcId: number,
    tagId: number,
    isWrite: boolean,
    value?: number | boolean | string
  ): Promise<number | boolean | string | null> {
    const managed = this.workers.get(plcId);
    if (!managed) {
      return Promise.reject(new Error('PLC worker çalışmıyor — önce başlatın'));
    }

    const requestId = ++this.requestCounter;

    return new Promise<number | boolean | string | null>((resolve, reject) => {
      const timer = setTimeout(() => {
        managed.pending.delete(requestId);
        reject(new Error('İstek zaman aşımına uğradı'));
      }, REQUEST_TIMEOUT_MS);

      managed.pending.set(requestId, { resolve, reject, timer, isWrite });

      const cmd: WorkerCommand = isWrite
        ? { cmd: 'write', requestId, tagId, value: value! }
        : { cmd: 'read', requestId, tagId };
      managed.worker.postMessage(cmd);
    });
  }

  private sendCommand(plcId: number, cmd: WorkerCommand): void {
    this.workers.get(plcId)?.worker.postMessage(cmd);
  }

  private handleWorkerMessage(plcId: number, msg: WorkerEvent): void {
    const managed = this.workers.get(plcId);
    if (!managed) return;

    switch (msg.event) {
      case 'status':
        managed.status = msg.status;
        managed.statusMessage = msg.message;
        wsManager.broadcast({
          type: 'plc:status',
          payload: { plcId, status: msg.status === 'stopped' ? 'offline' : msg.status === 'connecting' ? 'offline' : msg.status, message: msg.message },
        });
        break;

      case 'data': {
        for (const tv of msg.tags) {
          managed.lastValues.set(tv.tagId, tv);
        }
        // WebSocket: abone client'lara canlı veri
        wsManager.broadcastToPlcSubscribers(plcId, {
          type: 'plc:data',
          payload: { plcId, tags: msg.tags },
        });
        // Data listener'lar (Faz 4 DataCollector)
        for (const listener of this.dataListeners) {
          try {
            listener(plcId, msg.tags);
          } catch (err) {
            console.error('[worker-manager] Data listener hatası:', err);
          }
        }
        break;
      }

      case 'readResult': {
        const pending = managed.pending.get(msg.requestId);
        if (pending) {
          clearTimeout(pending.timer);
          managed.pending.delete(msg.requestId);
          pending.resolve(msg.value);
        }
        break;
      }

      case 'writeResult': {
        const pending = managed.pending.get(msg.requestId);
        if (pending) {
          clearTimeout(pending.timer);
          managed.pending.delete(msg.requestId);
          pending.resolve(true);
        }
        break;
      }

      case 'errorResult': {
        const pending = managed.pending.get(msg.requestId);
        if (pending) {
          clearTimeout(pending.timer);
          managed.pending.delete(msg.requestId);
          pending.reject(new Error(msg.message));
        }
        break;
      }
    }
  }

  private handleWorkerExit(plcId: number, code: number): void {
    const managed = this.workers.get(plcId);
    if (!managed) return;

    // Bekleyen istekleri reddet
    for (const pending of managed.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(new Error('Worker sonlandı'));
    }
    managed.pending.clear();

    // stop() çağrısı zaten cleanup yapar — exit oradan gelmediyse temizle
    if (code !== 0) {
      this.cleanup(plcId);
      this.setStatus(plcId, 'offline', `Worker beklenmedik şekilde kapandı (kod ${code})`);
    }
  }

  private cleanup(plcId: number): void {
    const managed = this.workers.get(plcId);
    if (!managed) return;
    managed.worker.removeAllListeners();
    this.workers.delete(plcId);
  }

  private setStatus(plcId: number, status: PlcStatus, message?: string): void {
    const managed = this.workers.get(plcId);
    if (managed) {
      managed.status = status;
      managed.statusMessage = message;
    }
    if (status === 'offline' || status === 'stopped') {
      wsManager.broadcast({
        type: 'plc:status',
        payload: { plcId, status: 'offline', message },
      });
    }
  }

  /** Tüm PLC'lerin worker durumlarını döner. */
  getStatuses(): Map<number, { status: PlcStatus; message?: string }> {
    const result = new Map<number, { status: PlcStatus; message?: string }>();
    for (const [plcId, managed] of this.workers) {
      result.set(plcId, { status: managed.status, message: managed.statusMessage });
    }
    return result;
  }

  getStatus(plcId: number): { status: PlcStatus; message?: string } {
    const managed = this.workers.get(plcId);
    return managed
      ? { status: managed.status, message: managed.statusMessage }
      : { status: 'stopped' };
  }

  isRunning(plcId: number): boolean {
    return this.workers.has(plcId);
  }

  /** Son okunan değerler (Live Monitor ilk yükleme). */
  getLastValues(plcId: number): TagValue[] {
    const managed = this.workers.get(plcId);
    return managed ? [...managed.lastValues.values()] : [];
  }
}

/**
 * PLC profil satırından worker/bağlantı testi için konfigürasyon üretir.
 * OPC UA şifresi burada çözülür (yalnızca bellek içinde, log'lanmaz).
 */
export function buildConnectionConfig(plc: PlcProfileRow) {
  const config = {
    protocol: plc.protocol,
    host: plc.host ?? undefined,
    port: plc.port,
    unitId: plc.unit_id,
    serialPort: plc.serial_port ?? undefined,
    baudRate: plc.baud_rate,
    dataBits: plc.data_bits,
    stopBits: plc.stop_bits,
    parity: (plc.parity as 'none' | 'even' | 'odd') ?? 'none',
  } as import('../plc.types.js').PlcConnectionConfig;

  if (plc.protocol === 'opcua') {
    config.endpointUrl = plc.endpoint_url ?? undefined;
    config.securityMode = plc.security_mode ?? 'None';
    config.securityPolicy = plc.security_policy ?? 'None';
    config.authType = plc.auth_type ?? 'anonymous';
    config.authUsername = plc.auth_username ?? undefined;
    config.sessionTimeoutMs = plc.session_timeout_ms ?? 30000;
    if (plc.auth_password_enc) {
      try {
        config.authPassword = decryptSecret(plc.auth_password_enc);
      } catch (err) {
        console.error(`[worker-manager] OPC UA şifresi çözülemedi (PLC ${plc.id}):`, err);
      }
    }
  }

  return config;
}

export const workerManager = new WorkerManager();

// Yeni PLC abonesine önbellekteki son değerleri anında ilet (subscribe replay).
// Subscribe modundaki statik tag'ler (örn. DeviceRevision) yalnızca bağlantı
// kurulurken bir kez bildirim ürettiğinden, sayfayı sonradan açan kullanıcı
// bu olayı kaçırır — replay ile son bilinen değerler hemen gösterilir.
wsManager.onPlcSubscribed = (plcId, send) => {
  const values = workerManager.getLastValues(plcId);
  if (values.length > 0) {
    send({ type: 'plc:data', payload: { plcId, tags: values } });
  }
};
