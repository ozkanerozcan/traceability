import { workerManager } from '../plc-gateway/workers/worker.manager.js';
import { getDb } from '../../core/database/connection.js';
import { qrToSvgPath } from './qr/qrcode.js';
import {
  addAlarm,
  addStationRecord,
  advanceProduct,
  assignTrolleySlot,
  createBatch,
  createProduct,
  generateProductId,
  getNextStationForProduct,
  getProductByProductId,
  getStationByKey,
  getTrolleyByCode,
  getTrolleySlots,
  hasRecord,
  parseCapabilities,
  parseConfig,
  setProductStatus,
  type ProductRow,
  type StationRow,
} from './trace.service.js';

/**
 * Station Engine: istasyonun `capabilities`'ine göre işlem doğrular ve yürütür.
 * Task Management: zorunlu görevler tamamlanmadan ürün bir sonraki istasyona ilerleyemez.
 */

export class StationError extends Error {
  constructor(
    public code: string,
    message: string,
    public details?: Record<string, unknown>
  ) {
    super(message);
    this.name = 'StationError';
  }
}

export interface ScanInput {
  stationKey: string;
  productId?: string;
  trolleyCode?: string;
  slotNumber?: number;
  status?: 'ok' | 'nok';
  batchNo?: string;
  data?: Record<string, unknown>;
  direction?: 'entry' | 'exit'; // wait_control için
}

export interface ScanResult {
  ok: boolean;
  productId?: string;
  qrLabel?: { productId: string; svgPath: string; size: number };
  message?: string;
  advanced?: boolean;
  alarm?: boolean;
}

// ─── PLC bridge ─────────────────────────────────────────────────────────────

async function readPlcValue(plcId: number, tagId: number): Promise<number | boolean | string | null> {
  return workerManager.readTag(plcId, tagId);
}

async function writePlcValue(plcId: number, tagId: number, value: number | boolean | string): Promise<void> {
  return workerManager.writeTag(plcId, tagId, value);
}

// ─── Task Management ────────────────────────────────────────────────────────

/**
 * Ürünün mevcut istasyondaki zorunlu görevleri tamamlanıp tamamlanmadığını kontrol eder.
 * Tamamsa ürünü bir sonraki istasyona ilerletir (veya rotanın sonundaysa 'completed' yapar).
 */
function tryAdvance(product: ProductRow, station: StationRow): boolean {
  const caps = parseCapabilities(station.capabilities);

  // Zorunlu görevler
  if (caps.includes('ok_nok') && !hasRecord(product.product_id, station.id, 'ok')) {
    // NOK ile reddedildiyse ilerleme yok
    if (hasRecord(product.product_id, station.id, 'nok')) return false;
    return false; // henüz OK verilmedi
  }
  if (caps.includes('plc_acquire') && !hasRecord(product.product_id, station.id)) {
    return false; // PLC verisi kaydedilmedi
  }
  if (caps.includes('batch_assign') && !hasRecord(product.product_id, station.id)) {
    return false; // batch bağlanmadı
  }
  if (caps.includes('wait_control') && !hasRecord(product.product_id, station.id, 'ok')) {
    return false; // bekleme tamamlanmadı
  }

  // Tüm görevler tamam → ilerlet
  advanceProduct(product.product_id);
  const next = getNextStationForProduct({ ...product, current_step_index: product.current_step_index + 1 });
  if (!next) {
    setProductStatus(product.product_id, 'completed');
  }
  return true;
}

// ─── Capability işleyicileri ────────────────────────────────────────────────

async function handleQrGenerate(station: StationRow, input: ScanInput, userId: number): Promise<ScanResult> {
  const productId = generateProductId();
  const product = createProduct({ productId, routeId: 1, qrContent: productId });
  const { path, size } = qrToSvgPath(productId);
  addStationRecord({
    productId,
    stationId: station.id,
    status: 'done',
    data: { qrContent: productId },
    operatorId: userId,
  });
  return {
    ok: true,
    productId: product.product_id,
    qrLabel: { productId, svgPath: path, size },
    advanced: tryAdvance(product, station),
  };
}

async function handleTrolleyAssign(station: StationRow, input: ScanInput, userId: number): Promise<ScanResult> {
  if (!input.trolleyCode) throw new StationError('VALIDATION', 'Araba (trolley) QR kodu taranmalıdır');
  if (!input.productId) throw new StationError('VALIDATION', 'Ürün QR kodu taranmalıdır');
  if (!input.slotNumber || input.slotNumber < 1) throw new StationError('VALIDATION', 'Geçerli bir slot numarası (1-20) girilmelidir');

  const trolley = getTrolleyByCode(input.trolleyCode);
  if (!trolley) throw new StationError('NOT_FOUND', `Araba bulunamadı: ${input.trolleyCode}`);
  if (input.slotNumber > trolley.slot_count) {
    throw new StationError('VALIDATION', `Slot numarası 1-${trolley.slot_count} arasında olmalıdır`);
  }

  const product = getProductByProductId(input.productId);
  if (!product) throw new StationError('NOT_FOUND', `Ürün bulunamadı: ${input.productId}`);

  // Tork değeri (config'de torqueTagId varsa PLC'den oku)
  const config = parseConfig(station.config);
  let torque: number | boolean | string | null = null;
  if (config.plcId && config.torqueTagId) {
    try {
      torque = await readPlcValue(config.plcId, config.torqueTagId);
    } catch {
      torque = null;
    }
  } else if (input.data?.torque !== undefined) {
    torque = Number(input.data.torque);
  }

  assignTrolleySlot(trolley.id, input.slotNumber, product.product_id);
  addStationRecord({
    productId: product.product_id,
    stationId: station.id,
    trolleyId: trolley.id,
    status: 'done',
    data: { slotNumber: input.slotNumber, torque },
    operatorId: userId,
  });

  return { ok: true, productId: product.product_id, advanced: tryAdvance(product, station) };
}

async function handlePlcAcquire(station: StationRow, input: ScanInput, userId: number): Promise<ScanResult> {
  const config = parseConfig(station.config);
  const data: Record<string, unknown> = { ...(input.data ?? {}) };

  // PLC'den canlı değer oku (config'de plcId + plcTagId varsa)
  if (config.plcId && config.plcTagId) {
    try {
      data.plcValue = await readPlcValue(config.plcId, config.plcTagId);
    } catch (err) {
      throw new StationError('PLC_CONNECTION_FAILED', 'PLC değeri okunamadı', { error: String(err) });
    }
  }

  // Filling: trolley pozisyonuna göre 4'lü grup; Probing: tüm 20 ürüne yay
  const groupSize = config.groupSize ?? 1;
  const targets: ProductRow[] = [];

  if (input.trolleyCode) {
    const trolley = getTrolleyByCode(input.trolleyCode);
    if (!trolley) throw new StationError('NOT_FOUND', `Araba bulunamadı: ${input.trolleyCode}`);
    const slots = getTrolleySlots(trolley.id);
    if (groupSize > 1 && slots.length > 0) {
      // Pozisyon tag'inden hangi grup işleniyor belirle
      let position = 0;
      if (config.plcId && config.positionTagId) {
        try {
          position = Number(await readPlcValue(config.plcId, config.positionTagId)) || 0;
        } catch {
          position = 0;
        }
      }
      const start = position * groupSize;
      const group = slots.filter((s) => s.slot_number > start && s.slot_number <= start + groupSize);
      for (const s of group) {
        const p = getProductByProductId(s.product_id);
        if (p) targets.push(p);
      }
    } else {
      // Tüm arabaya yay (Probing)
      for (const s of slots) {
        const p = getProductByProductId(s.product_id);
        if (p) targets.push(p);
      }
    }
  } else if (input.productId) {
    const p = getProductByProductId(input.productId);
    if (!p) throw new StationError('NOT_FOUND', `Ürün bulunamadı: ${input.productId}`);
    targets.push(p);
  } else {
    throw new StationError('VALIDATION', 'Araba veya ürün QR kodu taranmalıdır');
  }

  if (targets.length === 0) throw new StationError('NOT_FOUND', 'Veri yazılacak ürün bulunamadı');

  for (const product of targets) {
    addStationRecord({
      productId: product.product_id,
      stationId: station.id,
      status: 'done',
      data,
      batchNo: input.batchNo ?? null,
      operatorId: userId,
    });
    tryAdvance(product, station);
  }

  return { ok: true, message: `${targets.length} ürüne veri yazıldı` };
}

async function handleOkNok(station: StationRow, input: ScanInput, userId: number): Promise<ScanResult> {
  if (!input.productId) throw new StationError('VALIDATION', 'Ürün QR kodu taranmalıdır');
  if (!input.status || (input.status !== 'ok' && input.status !== 'nok')) {
    throw new StationError('VALIDATION', "OK veya NOK durumu seçilmelidir");
  }

  const product = getProductByProductId(input.productId);
  if (!product) throw new StationError('NOT_FOUND', `Ürün bulunamadı: ${input.productId}`);

  addStationRecord({
    productId: product.product_id,
    stationId: station.id,
    status: input.status,
    data: input.data ?? {},
    operatorId: userId,
  });

  if (input.status === 'nok') {
    setProductStatus(product.product_id, 'rejected');
    addAlarm({
      productId: product.product_id,
      stationId: station.id,
      severity: 'warning',
      message: `${station.name} istasyonunda NOK işaretlendi`,
    });
    return { ok: true, productId: product.product_id, advanced: false, alarm: true };
  }

  return { ok: true, productId: product.product_id, advanced: tryAdvance(product, station) };
}

async function handleBatchAssign(station: StationRow, input: ScanInput, userId: number): Promise<ScanResult> {
  if (!input.productId) throw new StationError('VALIDATION', 'Ürün QR kodu taranmalıdır');
  if (!input.batchNo) throw new StationError('VALIDATION', 'Parti (batch) numarası taranmalıdır');

  const product = getProductByProductId(input.productId);
  if (!product) throw new StationError('NOT_FOUND', `Ürün bulunamadı: ${input.productId}`);

  const config = parseConfig(station.config);
  createBatch(input.batchNo, config.componentKind ?? 'material');

  addStationRecord({
    productId: product.product_id,
    stationId: station.id,
    status: 'done',
    data: input.data ?? {},
    batchNo: input.batchNo,
    operatorId: userId,
  });

  return { ok: true, productId: product.product_id, advanced: tryAdvance(product, station) };
}

async function handleWaitControl(station: StationRow, input: ScanInput, userId: number): Promise<ScanResult> {
  if (!input.trolleyCode) throw new StationError('VALIDATION', 'Araba (trolley) QR kodu taranmalıdır');
  const trolley = getTrolleyByCode(input.trolleyCode);
  if (!trolley) throw new StationError('NOT_FOUND', `Araba bulunamadı: ${input.trolleyCode}`);

  const config = parseConfig(station.config);
  const waitHours = config.waitHours ?? 24;
  const direction = input.direction ?? 'entry';
  const slots = getTrolleySlots(trolley.id);

  if (direction === 'entry') {
    // Giriş: zaman damgası kaydet
    for (const s of slots) {
      addStationRecord({
        productId: s.product_id,
        stationId: station.id,
        trolleyId: trolley.id,
        status: 'entry',
        data: { entryAt: new Date().toISOString() },
        operatorId: userId,
      });
    }
    return { ok: true, message: `Giriş kaydedildi — ${waitHours} saat bekleme başladı` };
  }

  // Çıkış: bekleme süresi kontrolü
  const first = slots[0];
  if (!first) throw new StationError('NOT_FOUND', 'Arabada ürün bulunamadı');
  const entryRec = hasRecord(first.product_id, station.id, 'entry');

  // Giriş kaydı varsa süreyi hesapla
  let elapsedHours = waitHours; // giriş kaydı yoksa (test) geçir
  if (entryRec) {
    const rec = getDb()
      .prepare(
        `SELECT created_at FROM trace_station_records
         WHERE product_id = ? AND station_id = ? AND status = 'entry'
         ORDER BY id DESC LIMIT 1`
      )
      .get(first.product_id, station.id) as { created_at: string } | undefined;
    if (rec) {
      const entryAt = new Date(rec.created_at.replace(' ', 'T') + 'Z').getTime();
      elapsedHours = (Date.now() - entryAt) / (1000 * 60 * 60);
    }
  }

  if (elapsedHours < waitHours) {
    // Erken çıkış → alarm + PLC'ye alarm yaz + reddet
    addAlarm({
      trolleyId: trolley.id,
      stationId: station.id,
      severity: 'critical',
      message: `Araba ${waitHours} saat dolmadan çıkarıldı (${elapsedHours.toFixed(1)} saat geçti)`,
    });
    if (config.plcId && config.alarmTagId) {
      try {
        await writePlcValue(config.plcId, config.alarmTagId, 1);
      } catch {
        // PLC alarm yazılamazsa yalnızca DB alarmı kalır
      }
    }
    throw new StationError(
      'WAIT_NOT_COMPLETE',
      `Bekleme süresi tamamlanmadı — ${waitHours} saat gerekli, ${elapsedHours.toFixed(1)} saat geçti`,
      { elapsedHours, waitHours }
    );
  }

  // Süre tamam → tüm ürünlere OK
  for (const s of slots) {
    const product = getProductByProductId(s.product_id);
    if (!product) continue;
    addStationRecord({
      productId: product.product_id,
      stationId: station.id,
      trolleyId: trolley.id,
      status: 'ok',
      data: { elapsedHours: Number(elapsedHours.toFixed(2)) },
      operatorId: userId,
    });
    tryAdvance(product, station);
  }

  return { ok: true, message: `Kondisyonlama tamamlandı (${elapsedHours.toFixed(1)} saat)` };
}

// ─── Rota doğrulama ─────────────────────────────────────────────────────────

function validateRoute(station: StationRow, product: ProductRow | undefined): void {
  if (!product) return; // qr_generate gibi ürün gerektirmeyen istasyonlar
  if (product.status === 'rejected') {
    throw new StationError('ROUTE_REJECTED', `Ürün reddedilmiş durumda: ${product.product_id}`);
  }
  if (product.status === 'completed') {
    throw new StationError('ROUTE_REJECTED', `Ürün zaten tamamlanmış: ${product.product_id}`);
  }
  const expected = getNextStationForProduct(product);
  if (expected && expected.id !== station.id) {
    throw new StationError(
      'ROUTE_VIOLATION',
      `Rota ihlali — ürün şu an '${expected.name}' istasyonunda olmalı, '${station.name}' istasyonunda işlem yapılamaz`,
      { expectedStation: expected.key, attemptedStation: station.key }
    );
  }
}

// ─── Ana giriş noktası ──────────────────────────────────────────────────────

export async function processScan(input: ScanInput, userId: number): Promise<ScanResult> {
  const station = getStationByKey(input.stationKey);
  if (!station) throw new StationError('NOT_FOUND', `İstasyon bulunamadı: ${input.stationKey}`);
  if (station.is_active !== 1) throw new StationError('VALIDATION', `İstasyon devre dışı: ${station.name}`);

  const caps = parseCapabilities(station.capabilities);
  const product = input.productId ? getProductByProductId(input.productId) : undefined;

  // Rota doğrulama (qr_generate hariç tüm istasyonlar için)
  if (!caps.includes('qr_generate')) {
    validateRoute(station, product);
  }

  // Capability'lere göre işle (öncelik sırası)
  if (caps.includes('qr_generate')) return handleQrGenerate(station, input, userId);
  if (caps.includes('trolley_assign')) return handleTrolleyAssign(station, input, userId);
  if (caps.includes('wait_control')) return handleWaitControl(station, input, userId);
  if (caps.includes('plc_acquire')) return handlePlcAcquire(station, input, userId);
  if (caps.includes('batch_assign') && caps.includes('ok_nok')) {
    // Manuel montaj: batch + ok_nok birlikte
    if (input.batchNo) return handleBatchAssign(station, input, userId);
    return handleOkNok(station, input, userId);
  }
  if (caps.includes('batch_assign')) return handleBatchAssign(station, input, userId);
  if (caps.includes('ok_nok')) return handleOkNok(station, input, userId);

  throw new StationError('VALIDATION', `İstasyonun desteklenen bir capability'si yok: ${station.name}`);
}
