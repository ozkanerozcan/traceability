import { parentPort, workerData } from 'node:worker_threads';
import { createAdapter, type IProtocolAdapter } from '../adapters/index.js';
import { OpcUaAdapter, OpcUaCertUntrustedError } from '../adapters/opcua.adapter.js';
import { recordPendingServerCert } from '../adapters/certificate.manager.js';
import { decodeRegisters, encodeValue, registerCount, toModbusAddress } from '../adapters/value-codec.js';
import type {
  TagConfig,
  TagQuality,
  TagValue,
  WorkerCommand,
  WorkerEvent,
  WorkerInitData,
} from '../plc.types.js';

const RECONNECT_INTERVAL_MS = 5000;
/** OPC UA canlılık sondası aralığı — kopma algılama üst sınırı ≈ bu süre + probe timeout (5sn) */
const WATCHDOG_INTERVAL_MS = 5000;

const { plcId, connection, tags: initialTags } = workerData as WorkerInitData;
const isOpcUa = connection.protocol === 'opcua';

let modbusAdapter: IProtocolAdapter | null = null;
let opcuaAdapter: OpcUaAdapter | null = null;
let tags: TagConfig[] = initialTags;
let timers: NodeJS.Timeout[] = [];
let watchdog: NodeJS.Timeout | null = null;
let stopped = false;
let connecting = false;

function post(msg: WorkerEvent): void {
  parentPort?.postMessage(msg);
}

function clearPolling(): void {
  for (const timer of timers) clearInterval(timer);
  timers = [];
}

function isAnyAdapterConnected(): boolean {
  return isOpcUa ? (opcuaAdapter?.isConnected() ?? false) : (modbusAdapter?.isConnected() ?? false);
}

/** Tek bir tag'i okur; değeri ve kalitesini döner. */
async function readTagValue(
  tag: TagConfig
): Promise<{ value: number | boolean | string | null; quality: TagQuality }> {
  if (isOpcUa) {
    if (!opcuaAdapter) throw new Error('Adaptör yok');
    const result = await opcuaAdapter.readValue(String(tag.address));
    return { value: result.value, quality: result.quality };
  }

  if (!modbusAdapter) throw new Error('Adaptör yok');
  const address = toModbusAddress(Number(tag.address), tag.registerType);

  switch (tag.registerType) {
    case 'holding': {
      const regs = await modbusAdapter.readHoldingRegisters(address, registerCount(tag.dataType));
      return { value: decodeRegisters(regs, tag.dataType, tag.wordSwap, tag.byteSwap), quality: 'good' };
    }
    case 'input': {
      const regs = await modbusAdapter.readInputRegisters(address, registerCount(tag.dataType));
      return { value: decodeRegisters(regs, tag.dataType, tag.wordSwap, tag.byteSwap), quality: 'good' };
    }
    case 'coil': {
      const bits = await modbusAdapter.readCoils(address, 1);
      return { value: bits[0] ?? false, quality: 'good' };
    }
    case 'discrete': {
      const bits = await modbusAdapter.readDiscreteInputs(address, 1);
      return { value: bits[0] ?? false, quality: 'good' };
    }
  }
}

/** Tek bir tag'e değer yazar. */
async function writeTagValue(tag: TagConfig, value: number | boolean | string): Promise<void> {
  if (isOpcUa) {
    if (!opcuaAdapter) throw new Error('Adaptör yok');
    await opcuaAdapter.writeValue(String(tag.address), value, tag.dataType);
    return;
  }

  if (!modbusAdapter) throw new Error('Adaptör yok');
  const address = toModbusAddress(Number(tag.address), tag.registerType);

  if (tag.registerType === 'coil') {
    await modbusAdapter.writeCoil(address, Boolean(value));
    return;
  }
  if (tag.registerType !== 'holding') {
    throw new Error('Yalnızca holding register ve coil yazılabilir');
  }

  const registers = encodeValue(Number(value), tag.dataType, tag.wordSwap, tag.byteSwap);
  if (registers.length === 1) {
    await modbusAdapter.writeRegister(address, registers[0]);
  } else {
    await modbusAdapter.writeRegisters(address, registers);
  }
}

/**
 * Polling gruplarını kurar.
 * - Modbus: tüm tag'ler poll edilir
 * - OPC UA: yalnızca acquisitionMode='poll' olan tag'ler (subscribe'lar MonitoredItem ile izlenir)
 */
function startPolling(): void {
  clearPolling();

  const pollTags = isOpcUa
    ? tags.filter((t) => t.acquisitionMode !== 'subscribe')
    : tags;

  const groups = new Map<number, TagConfig[]>();
  for (const tag of pollTags) {
    const interval = Math.max(tag.pollingIntervalMs, 100); // alt sınır 100ms
    if (!groups.has(interval)) groups.set(interval, []);
    groups.get(interval)!.push(tag);
  }

  for (const [intervalMs, groupTags] of groups) {
    let reading = false;

    const timer = setInterval(() => {
      if (stopped || reading || !isAnyAdapterConnected()) return;
      reading = true;

      void (async () => {
        const values: TagValue[] = [];
        // Bağlantı başına tekil işlem — sırayla oku
        for (const tag of groupTags) {
          if (stopped) return;
          try {
            const { value, quality } = await readTagValue(tag);
            values.push({ tagId: tag.id, value, quality, timestamp: new Date().toISOString() });
          } catch (err) {
            // Bağlantı hatası → offline'a geç ve reconnect başlat
            handleConnectionError(err);
            return;
          }
        }
        if (values.length > 0 && !stopped) {
          post({ event: 'data', tags: values });
        }
      })().finally(() => {
        reading = false;
      });
    }, intervalMs);

    timers.push(timer);
  }
}

/**
 * OPC UA canlılık sondası: subscribe modunda kablo kopması/sunucu donması
 * veri akışını sessizce durdurduğundan, periyodik olarak sunucuyu yoklar.
 * Sonda başarısız olursa handleConnectionError → offline + otomatik reconnect.
 */
function startWatchdog(): void {
  stopWatchdog();
  if (!isOpcUa) return;
  watchdog = setInterval(() => {
    if (stopped || connecting || !opcuaAdapter?.isConnected()) return;
    opcuaAdapter.probe().catch((err: unknown) => {
      handleConnectionError(err instanceof Error ? err : new Error('Canlılık sondası başarısız'));
    });
  }, WATCHDOG_INTERVAL_MS);
}

function stopWatchdog(): void {
  if (watchdog) {
    clearInterval(watchdog);
    watchdog = null;
  }
}

/** OPC UA: subscribe modundaki tag'ler için MonitoredItem'ları kurar. */
async function startOpcUaSubscription(): Promise<void> {
  if (!isOpcUa || !opcuaAdapter) return;

  const subscribeTags = tags.filter((t) => t.acquisitionMode === 'subscribe');
  if (subscribeTags.length === 0) return;

  await opcuaAdapter.subscribe(
    subscribeTags.map((t) => ({
      tagId: t.id,
      nodeId: String(t.address),
      samplingIntervalMs: Math.max(t.pollingIntervalMs, 100),
    })),
    (tagId, result) => {
      if (stopped) return;
      post({
        event: 'data',
        tags: [
          { tagId, value: result.value, quality: result.quality, timestamp: new Date().toISOString() },
        ],
      });
    }
  );
}

function handleConnectionError(err: unknown): void {
  if (stopped) return;
  clearPolling();
  stopWatchdog();
  const message = err instanceof Error ? err.message : 'Bilinmeyen bağlantı hatası';
  post({ event: 'status', status: 'offline', message });
  void modbusAdapter?.disconnect().catch(() => undefined);
  void opcuaAdapter?.disconnect().catch(() => undefined);
  scheduleReconnect();
}

function scheduleReconnect(): void {
  if (stopped) return;
  const timer = setTimeout(() => {
    void connect();
  }, RECONNECT_INTERVAL_MS);
  timers.push(timer);
}

async function connect(): Promise<void> {
  if (stopped || connecting) return;
  connecting = true;

  try {
    post({ event: 'status', status: 'connecting' });

    if (isOpcUa) {
      opcuaAdapter = new OpcUaAdapter(connection);
      opcuaAdapter.onDisconnect = (message) => {
        if (!stopped) handleConnectionError(new Error(message));
      };

      try {
        await opcuaAdapter.connect();
      } catch (err) {
        if (err instanceof OpcUaCertUntrustedError) {
          // TOFU: sertifikayı pending kaydet, admin onayı bekle — retry YOK
          recordPendingServerCert(plcId, err.certInfo);
          post({
            event: 'status',
            status: 'cert_pending',
            message: `Sunucu sertifikası onay bekliyor (${err.certInfo.subject || err.certInfo.thumbprint})`,
          });
          return;
        }
        throw err;
      }

      if (stopped) {
        await opcuaAdapter.disconnect().catch(() => undefined);
        return;
      }
      post({ event: 'status', status: 'online' });
      startPolling();
      await startOpcUaSubscription().catch((err: unknown) => {
        handleConnectionError(err);
      });
      startWatchdog();
      return;
    }

    // ─── Modbus akışı ───
    modbusAdapter = createAdapter(connection);
    await modbusAdapter.connect();
    if (stopped) {
      await modbusAdapter.disconnect().catch(() => undefined);
      return;
    }
    post({ event: 'status', status: 'online' });
    startPolling();
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Bağlantı kurulamadı';
    post({ event: 'status', status: 'offline', message });
    scheduleReconnect();
  } finally {
    connecting = false;
  }
}

async function shutdown(): Promise<void> {
  stopped = true;
  clearPolling();
  stopWatchdog();
  if (modbusAdapter) {
    await modbusAdapter.disconnect().catch(() => undefined);
    modbusAdapter = null;
  }
  if (opcuaAdapter) {
    await opcuaAdapter.disconnect().catch(() => undefined);
    opcuaAdapter = null;
  }
  post({ event: 'status', status: 'stopped' });
}

parentPort?.on('message', (msg: WorkerCommand) => {
  switch (msg.cmd) {
    case 'stop':
      void shutdown();
      break;

    case 'read': {
      const tag = tags.find((t) => t.id === msg.tagId);
      if (!tag) {
        post({ event: 'errorResult', requestId: msg.requestId, message: 'Tag bulunamadı' });
        break;
      }
      if (!isAnyAdapterConnected()) {
        post({ event: 'errorResult', requestId: msg.requestId, message: 'PLC çevrimdışı' });
        break;
      }
      readTagValue(tag)
        .then(({ value }) => post({ event: 'readResult', requestId: msg.requestId, value }))
        .catch((err: unknown) => {
          post({
            event: 'errorResult',
            requestId: msg.requestId,
            message: err instanceof Error ? err.message : 'Okuma hatası',
          });
          handleConnectionError(err);
        });
      break;
    }

    case 'write': {
      const tag = tags.find((t) => t.id === msg.tagId);
      if (!tag) {
        post({ event: 'errorResult', requestId: msg.requestId, message: 'Tag bulunamadı' });
        break;
      }
      if (!isAnyAdapterConnected()) {
        post({ event: 'errorResult', requestId: msg.requestId, message: 'PLC çevrimdışı' });
        break;
      }
      writeTagValue(tag, msg.value)
        .then(() => post({ event: 'writeResult', requestId: msg.requestId }))
        .catch((err: unknown) => {
          post({
            event: 'errorResult',
            requestId: msg.requestId,
            message: err instanceof Error ? err.message : 'Yazma hatası',
          });
          handleConnectionError(err);
        });
      break;
    }

    case 'updateTags':
      tags = msg.tags;
      if (isOpcUa) {
        // Subscription/polling ayrımı değişmiş olabilir — bağlantıyı sıfırdan kur
        if (opcuaAdapter?.isConnected() && !connecting) {
          clearPolling();
          void opcuaAdapter.disconnect().then(() => connect());
        }
        break;
      }
      // Modbus: polling aktifse grupları yeniden kur
      if (modbusAdapter?.isConnected()) {
        startPolling();
      }
      break;
  }
});

// Worker başlar başlamaz bağlan
void connect();
