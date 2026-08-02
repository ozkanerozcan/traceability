import { workerManager } from '../plc-gateway/workers/worker.manager.js';
import { getDb } from '../../core/database/connection.js';
import { getSetting } from '../system-settings/settings.service.js';
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
  getStation,
  getStationByKey,
  getStationContext,
  getTrolley,
  getTrolleyByCode,
  getTrolleySlots,
  hasRecord,
  listStations,
  nextFreeSlot,
  parseCapabilities,
  parseConfig,
  setActiveProduct,
  clearActiveProduct,
  setLastCapture,
  setProductStatus,
  type ProductRow,
  type StationRow,
} from './trace.service.js';

/**
 * Station Engine: istasyonun `capabilities`'ine göre işlem doğrular ve yürütür.
 * Task Management: zorunlu görevler tamamlanmadan ürün bir sonraki istasyona ilerleyemez.
 *
 * Yetenek modeli:
 * - qr_generate: QR üret + yazdır (ürün oluşturur).
 * - trolley_read (Araba Okuma): önceden onaylanmış AKTİF arabaya ürün işler.
 * - plc_acquire (PLC Data): ürün okutulunca AKTİF ürün olur; trigger biti
 *   true olunca seçili tag'ler PLC'den okunup ürüne yazılır (capturePlcData).
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
  if (caps.includes('plc_acquire') && !hasRecord(product.product_id, station.id, 'done')) {
    return false; // PLC verisi henüz ürüne yazılmadı (trigger bekleniyor)
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
  const productId = input.productId?.trim() ? input.productId.trim() : generateProductId();
  if (getProductByProductId(productId)) {
    throw new StationError('VALIDATION', `Bu Shell ID zaten kullanılmaktadır: ${productId}`);
  }
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

/**
 * Araba Okuma (trolley_read): AKTİF arabaya ürün işler.
 * - Önce istasyon sayfasında araba onaylanmış olmalı (setActiveTrolley).
 * - plc_acquire trigger'ı varsa slot + veri trigger ile gelir → ürün AKTİF olur, beklemede kalır.
 * - Trigger yoksa ürün sonraki boş slota otomatik atanır ve ilerletilir.
 */
async function handleTrolleyRead(station: StationRow, input: ScanInput, userId: number): Promise<ScanResult> {
  const ctx = getStationContext(station.id);
  if (!ctx.trolleyId) {
    throw new StationError('VALIDATION', 'Önce araba (trolley) onaylanmalıdır');
  }
  if (!input.productId) throw new StationError('VALIDATION', 'Ürün QR kodu taranmalıdır');

  const product = getProductByProductId(input.productId);
  if (!product) throw new StationError('NOT_FOUND', `Ürün bulunamadı: ${input.productId}`);

  const caps = parseCapabilities(station.capabilities);
  const config = parseConfig(station.config);
  const hasTrigger = caps.includes('plc_acquire') && !!config.triggerTagId;

  if (hasTrigger) {
    // Ürün bu istasyonda AKTİF olur (PLC Data trigger'ı bu ürüne yazacak);
    // slot + veri trigger ile gelecek → beklemede
    setActiveProduct(station.id, product.product_id);
    addStationRecord({
      productId: product.product_id,
      stationId: station.id,
      trolleyId: ctx.trolleyId,
      status: 'scanned',
      data: {},
      operatorId: userId,
    });
    return {
      ok: true,
      productId: product.product_id,
      message: `Ürün ${ctx.trolleyCode} arabasına alındı — PLC verisi bekleniyor`,
    };
  }

  // Trigger yok → sonraki boş slota otomatik ata (aktif ürün tutulmaz)
  const trolley = getTrolley(ctx.trolleyId);
  if (!trolley) throw new StationError('NOT_FOUND', 'Aktif araba bulunamadı');
  const slot = nextFreeSlot(trolley.id, trolley.slot_count);
  if (!slot) {
    throw new StationError('VALIDATION', `Araba ${trolley.code} dolu (${trolley.slot_count}/${trolley.slot_count}) — yeni araba onaylayın`);
  }
  assignTrolleySlot(trolley.id, slot, product.product_id);
  addStationRecord({
    productId: product.product_id,
    stationId: station.id,
    trolleyId: trolley.id,
    status: 'done',
    data: { slotNumber: slot },
    operatorId: userId,
  });

  return { ok: true, productId: product.product_id, advanced: tryAdvance(product, station) };
}

/**
 * PLC Data (plc_acquire) taraması: ürün AKTİF olur.
 * Asıl veri, trigger biti true olunca capturePlcData ile yazılır.
 */
async function handlePlcAcquireScan(station: StationRow, input: ScanInput, userId: number): Promise<ScanResult> {
  if (!input.productId) throw new StationError('VALIDATION', 'Ürün QR kodu taranmalıdır');
  const product = getProductByProductId(input.productId);
  if (!product) throw new StationError('NOT_FOUND', `Ürün bulunamadı: ${input.productId}`);

  setActiveProduct(station.id, product.product_id);
  addStationRecord({
    productId: product.product_id,
    stationId: station.id,
    status: 'scanned',
    data: {},
    operatorId: userId,
  });

  return { ok: true, productId: product.product_id, message: 'Ürün aktif — PLC verisi bekleniyor' };
}

/**
 * PLC Data trigger yakalandığında çağrılır (plc-data-watcher).
 * Trigger biti true olduğunda config'deki dataTagIds değerlerini PLC'den okuyup
 * istasyonun AKTİF ürününe yazar. Slot/pozisyon bilgisi de dataTagIds içinde
 * yer alır; scan modunda aktif araba varsa ürün sonraki boş slota atanır.
 */
export async function capturePlcData(stationId: number): Promise<void> {
  const station = getStation(stationId);
  if (!station) return;
  const config = parseConfig(station.config);
  if (!config.plcId || !config.triggerTagId) return;

  const plcId = config.plcId;
  const triggerTagId = config.triggerTagId;

  // Handshake: işlem bitince trigger'ı false'a çek → PLC "okuma bitti" anlar ve
  // yeni değerleri trigger edebilir. Watcher false bildiriminde otomatik re-arm olur.
  const acknowledge = async () => {
    try {
      await writePlcValue(plcId, triggerTagId, false);
    } catch {
      // trigger yazılamazsa (salt okunur) yok say
    }
  };

  const ctx = getStationContext(stationId);
  const source = config.shellIdSource ?? 'plc';

  // ─── Hedef ürün(ler)i Shell ID kaynağına göre belirle ───
  const targets: ProductRow[] = [];

  if (source === 'plc') {
    // Senaryo 1: Shell ID doğrudan PLC tag'inden okunur
    if (config.shellIdTagId) {
      let shellId: string | null = null;
      try {
        const v = await readPlcValue(plcId, config.shellIdTagId);
        shellId = v === null ? null : String(v).trim();
      } catch {
        shellId = null;
      }
      if (shellId) {
        const p = getProductByProductId(shellId);
        if (p) targets.push(p);
      }
    }
  } else if (source === 'trolley') {
    // Senaryo 2: Trolley ID PLC tag'inden okunur (varsa) veya aktif araba bağlamından alınır
    let trolleyId = ctx.trolleyId;
    if (config.trolleyIdTagId) {
      try {
        const v = await readPlcValue(plcId, config.trolleyIdTagId);
        if (v !== null && String(v).trim()) {
          const trCode = String(v).trim();
          const tr = getTrolleyByCode(trCode);
          if (tr) trolleyId = tr.id;
        }
      } catch {
        // fallback to ctx.trolleyId
      }
    }
    if (trolleyId) {
      const slots = getTrolleySlots(trolleyId);
      const systemRowSize = Number(getSetting('row_size')) || 4;
      const rowSize = config.rowSize ?? systemRowSize;
      if (config.trolleyMatchMode === 'row' && config.rowTagId) {
        // Satır bazlı: PLC'den satır numarası oku (1. satır = 1 veya 0 → 1..4 slotlar; 2. satır = 2 → 5..8 slotlar)
        let rowNum = 0;
        try {
          rowNum = Number(await readPlcValue(plcId, config.rowTagId)) || 0;
        } catch {
          rowNum = 0;
        }
        const rowIndex = Math.max(0, rowNum > 0 ? rowNum - 1 : 0);
        const start = rowIndex * rowSize;
        for (const s of slots) {
          if (s.slot_number > start && s.slot_number <= start + rowSize) {
            const p = getProductByProductId(s.product_id);
            if (p) targets.push(p);
          }
        }
      } else {
        // Tüm ürünler: arabada o an bulunan her Shell ID'ye uygula
        for (const s of slots) {
          const p = getProductByProductId(s.product_id);
          if (p) targets.push(p);
        }
      }
    }
  } else {
    // 'scan': taranan AKTİF ürün
    if (ctx.productId) {
      const p = getProductByProductId(ctx.productId);
      if (p) targets.push(p);
    }
  }

  if (targets.length === 0) {
    addAlarm({
      stationId,
      severity: 'warning',
      message: `${station.name}: PLC trigger geldi ancak hedef ürün bulunamadı (kaynak: ${source})`,
    });
    await acknowledge();
    return;
  }

  // ─── Yeniden tetik koruması (idempotency) ───
  // Aynı ürün bu istasyonda zaten 'done' kaydına sahipse veriyi ikinci kez
  // yazma — aynı veri aynı shell içinde yalnızca BİR KEZ bulunmalıdır.
  // (Trigger'ın handshake tamamlanmadan yeniden yükselmesi durumunda oluşan
  // mükerrer 'done' kayıtlarını engeller.) Yine de handshake gönderilir.
  const pendingTargets = targets.filter((p) => !hasRecord(p.product_id, stationId, 'done'));
  if (pendingTargets.length === 0) {
    console.warn(
      `[station.engine] ${station.name}: trigger yeniden geldi ancak hedef ürün(ler) zaten işlendi — mükerrer kayıt atlandı (${targets.map((t) => t.product_id).join(', ')})`
    );
    await acknowledge();
    return;
  }
  targets.length = 0;
  targets.push(...pendingTargets);

  // ─── Veri tag'lerini taze oku ───
  const data: Record<string, unknown> = {};
  if (config.dataTagIds?.length) {
    for (const tagId of config.dataTagIds) {
      try {
        data[`tag_${tagId}`] = await readPlcValue(plcId, tagId);
      } catch {
        data[`tag_${tagId}`] = null;
      }
    }
  }

  // ─── Hedef ürün(ler)e veriyi yaz + ilerlet ───
  for (const product of targets) {
    // plc modunda aktif araba varsa slot numarasına ata (slotTagId PLC'den okunur)
    let slot: number | null = null;
    if (source === 'plc' && ctx.trolleyId) {
      if (config.slotTagId) {
        try {
          const vSlot = await readPlcValue(plcId, config.slotTagId);
          slot = vSlot !== null ? Number(vSlot) : null;
        } catch {
          slot = null;
        }
      }
      if (!slot) {
        const trolley = getTrolley(ctx.trolleyId);
        if (trolley) {
          slot = nextFreeSlot(trolley.id, trolley.slot_count);
        }
      }
      if (slot) {
        try {
          assignTrolleySlot(ctx.trolleyId, slot, product.product_id);
        } catch {
          // slot dolu olabilir — kaydı yine de yaz
        }
      }
    }
    addStationRecord({
      productId: product.product_id,
      stationId,
      trolleyId: ctx.trolleyId ?? null,
      status: 'done',
      data,
    });
    tryAdvance(product, station);
  }

  // Son yakalanan veriyi bağlama yaz (UI'da "verileri görebiliriz" için)
  setLastCapture(stationId, {
    productId: targets.length === 1 ? targets[0].product_id : `${targets.length} ürün`,
    data,
    slot: null,
    at: new Date().toISOString(),
  });

  // Ürün işlendi → sonraki ürün için yeni okutma gerekir (scan modunda)
  clearActiveProduct(stationId);

  // Handshake: okuma bitti → trigger'ı false'a çek
  await acknowledge();
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
  if (caps.includes('trolley_read')) return handleTrolleyRead(station, input, userId);
  if (caps.includes('wait_control')) return handleWaitControl(station, input, userId);
  if (caps.includes('plc_acquire')) return handlePlcAcquireScan(station, input, userId);
  if (caps.includes('batch_assign') && caps.includes('ok_nok')) {
    // Manuel montaj: batch + ok_nok birlikte
    if (input.batchNo) return handleBatchAssign(station, input, userId);
    return handleOkNok(station, input, userId);
  }
  if (caps.includes('batch_assign')) return handleBatchAssign(station, input, userId);
  if (caps.includes('ok_nok')) return handleOkNok(station, input, userId);

  throw new StationError('VALIDATION', `İstasyonun desteklenen bir capability'si yok: ${station.name}`);
}

export async function createNewProduct(userId: number): Promise<{
  product: ProductRow;
  qrLabel: {
    productId: string;
    qrContent: string;
    svgPath: string;
    size: number;
    widthMm: number;
    heightMm: number;
  };
}> {
  const stations = listStations();
  const qrStation = stations.find((s) => parseCapabilities(s.capabilities).includes('qr_generate'));

  if (qrStation) {
    const res = await processScan({ stationKey: qrStation.key }, userId);
    const productId = res.productId!;
    const prod = getProductByProductId(productId)!;
    const config = parseConfig(qrStation.config);
    return {
      product: prod,
      qrLabel: {
        productId,
        qrContent: productId,
        svgPath: res.qrLabel?.svgPath ?? '',
        size: res.qrLabel?.size ?? 128,
        widthMm: config.labelWidth ?? 50,
        heightMm: config.labelHeight ?? 30,
      },
    };
  }

  const productId = generateProductId();
  const product = createProduct({ productId, routeId: 1, qrContent: productId });
  const { path, size } = qrToSvgPath(productId);

  return {
    product,
    qrLabel: {
      productId,
      qrContent: productId,
      svgPath: path,
      size,
      widthMm: 50,
      heightMm: 30,
    },
  };
}
