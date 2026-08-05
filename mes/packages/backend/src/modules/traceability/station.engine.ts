import { workerManager } from '../plc-gateway/workers/worker.manager.js';
import { getSetting } from '../system-settings/settings.service.js';
import { qrToSvgPath } from './qr/qrcode.js';
import {
  addStationRecord,
  assignTrolleySlot,
  createProduct,
  generateProductId,
  getLastReadTrolleyCode,
  getProductByProductId,
  getStation,
  getTagName,
  getTrolleyByCode,
  getTrolleySlots,
  listStations,
  parseConfig,
  releaseTrolley,
  setRuntimeCapture,
  setRuntimeTrolley,
  upsertMeasurement,
  type StationConfig,
  type StationRow,
} from './trace.service.js';

/**
 * Station Engine — istasyon TİPİNE göre çalışır (yetenek sistemi kaldırıldı).
 *
 * Her PLC'li istasyon standart tag sözleşmesini kullanır:
 *   ShellId / TrolleyId / SlotNumber / RowNumber / Trigger / Data/<tagAdı>
 *   Sonuç: Ack(bool), ErrorCode(int), ErrorMessage(string), Busy(bool)
 *
 * Akış (PLC tetikleme):
 *   Trigger yükselen kenar → önceki sonuçlar temizlenir + Busy=true →
 *   sözleşme tag'leri okunur → tip handler'ı çalışır →
 *   başarıda Ack=true / hatada ErrorCode+ErrorMessage → Busy=false →
 *   Trigger=false (handshake — PLC yeniden tetikleyebilir).
 *
 * Akış (manuel tetikleme — web arayüzü):
 *   Aynı handler'lar payload ile çalışır; PLC tag okuma/yazma YAPILMAZ.
 *   Böylece PLC'den hiç veri gelmemiş olsa bile web'den veri girilebilir.
 */

// ─── Hata kodları (ErrorCode int sözleşmesi) ────────────────────────────────

export const PLC_ERR = {
  NONE: 0,
  SHELL_NOT_FOUND: 1,    // Shell ID sistemde kayıtlı değil
  TROLLEY_NOT_FOUND: 2,  // Trolley ID sistemde kayıtlı değil
  SLOT_INVALID: 3,       // Slot numarası geçersiz / kapasite dışı
  NO_ACTIVE_TROLLEY: 4,  // Trolley Okuma'da okunmuş araba yok
  EMPTY_TARGET: 5,       // Hedefte ürün yok (satır/araba boş)
  PLC_READ_ERROR: 6,     // PLC tag'i okunamadı
  INVALID_DATA: 7,       // Zorunlu veri eksik/geçersiz
  SLOT_OCCUPIED: 8,      // Slot başka bir shell tarafından dolu
} as const;

export class StationError extends Error {
  constructor(
    public code: string,
    message: string,
    public errorCode: number = PLC_ERR.INVALID_DATA,
    public details?: Record<string, unknown>
  ) {
    super(message);
    this.name = 'StationError';
  }
}

// ─── Girdi/çıktı tipleri ────────────────────────────────────────────────────

export interface TriggerDataItem {
  field: string;                                  // ölçüm alanı adı (tag adı veya manuel)
  tagId?: number;                                 // PLC tag id (varsa)
  value: number | string | boolean | null;
}

export interface TriggerInput {
  shellId?: string;
  trolleyId?: string;
  slotNumber?: number;
  rowNumber?: number;
  data: TriggerDataItem[];
}

export interface QrLabelResult {
  productId: string;
  qrContent: string;
  svgPath: string;
  size: number;
  widthMm: number;
  heightMm: number;
}

export interface TriggerResult {
  ok: boolean;
  message?: string;
  errorCode?: number;
  qrLabel?: QrLabelResult;
}

export interface ManualPayload {
  shellId?: string;
  trolleyId?: string;
  slotNumber?: number;
  rowNumber?: number;
  data?: Record<string, unknown>;
}

// ─── Yardımcılar ────────────────────────────────────────────────────────────

/** TriggerInput.data → { alan: değer } (history kaydı + lastCapture için) */
function dataToRecord(data: TriggerDataItem[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const d of data) {
    if (d.value !== null && d.value !== undefined) out[d.field] = d.value;
  }
  return out;
}

/** Ölçümleri shell'e yazar (UPSERT). Null değerler atlanır. */
function writeMeasurements(
  station: StationRow,
  shellId: string,
  data: TriggerDataItem[],
  source: 'plc' | 'manual'
): void {
  for (const d of data) {
    if (d.value === null || d.value === undefined) continue;
    upsertMeasurement({
      shellId,
      stationKey: station.key,
      field: d.field,
      tagId: d.tagId ?? null,
      value: d.value,
      source,
    });
  }
}

function nowIso(): string {
  return new Date().toISOString();
}

// ─── İstasyon tipi handler'ları ─────────────────────────────────────────────

/** QR Kod Üretim — Shell ID üret/validate et, ürün oluştur, QR etiket döndür. */
function handleQrGenerate(station: StationRow, shellIdInput: string | undefined, userId?: number): TriggerResult {
  const productId = shellIdInput?.trim() ? shellIdInput.trim() : generateProductId();
  if (getProductByProductId(productId)) {
    throw new StationError('VALIDATION', `Bu Shell ID zaten kullanılmaktadır: ${productId}`, PLC_ERR.INVALID_DATA);
  }
  createProduct({ productId, qrContent: productId });
  const { path, size } = qrToSvgPath(productId);
  addStationRecord({
    productId,
    stationId: station.id,
    status: 'done',
    data: { qrContent: productId },
    operatorId: userId ?? null,
  });
  const config = parseConfig(station.config);
  return {
    ok: true,
    message: `Ürün oluşturuldu: ${productId}`,
    qrLabel: {
      productId,
      qrContent: productId,
      svgPath: path,
      size,
      widthMm: config.labelWidth ?? 50,
      heightMm: config.labelHeight ?? 30,
    },
  };
}

/**
 * Trolley Okuma — PLC'den yalnız TrolleyId gelir.
 * Okunan araba trace_station_runtime'a DB'de yazılır; Trolley-Shell
 * Eşleştirme istasyonu bu bilgiyi kullanır. clearOnRead aktifse arabanın
 * önceki slot içeriği temizlenir (araba tekrar kullanımı; kapasite korunur).
 */
function handleTrolleyRead(station: StationRow, input: TriggerInput): TriggerResult {
  if (!input.trolleyId) {
    throw new StationError('VALIDATION', 'Trolley ID okunamadı veya boş', PLC_ERR.INVALID_DATA);
  }
  const trolley = getTrolleyByCode(input.trolleyId);
  if (!trolley) {
    throw new StationError('NOT_FOUND', `Araba kayıtlı değil: ${input.trolleyId}`, PLC_ERR.TROLLEY_NOT_FOUND);
  }
  const config = parseConfig(station.config);
  if (config.clearOnRead !== false) {
    releaseTrolley(trolley.id);
  }
  setRuntimeTrolley(station.id, trolley.code);
  setRuntimeCapture(station.id, {
    at: nowIso(),
    summary: trolley.code,
    data: {},
  });
  return { ok: true, message: `Araba okundu: ${trolley.code}` };
}

/** Funnel Sıkma — PLC'den ShellId + Data (funnel sıkma torku vb.) gelir. */
function handleFunnelScrewing(
  station: StationRow,
  input: TriggerInput,
  source: 'plc' | 'manual',
  userId?: number
): TriggerResult {
  if (!input.shellId) {
    throw new StationError('VALIDATION', 'Shell ID okunamadı veya boş', PLC_ERR.INVALID_DATA);
  }
  const product = getProductByProductId(input.shellId);
  if (!product) {
    throw new StationError('NOT_FOUND', `Shell kayıtlı değil: ${input.shellId}`, PLC_ERR.SHELL_NOT_FOUND);
  }
  writeMeasurements(station, product.product_id, input.data, source);
  const record = dataToRecord(input.data);
  addStationRecord({
    productId: product.product_id,
    stationId: station.id,
    status: 'done',
    data: record,
    operatorId: userId ?? null,
  });
  setRuntimeCapture(station.id, { at: nowIso(), summary: product.product_id, data: record });
  return { ok: true, message: `${product.product_id}: funnel verisi kaydedildi` };
}

/**
 * Trolley-Shell Eşleştirme — PLC'den ShellId + SlotNumber gelir.
 * Trolley Okuma istasyonunda en son okunan araba ile eşleştirilir;
 * shells tablosunda trolley_id + slot_number doldurulur.
 */
function handleMatching(
  station: StationRow,
  input: TriggerInput,
  _source: 'plc' | 'manual',
  userId?: number
): TriggerResult {
  if (!input.shellId) {
    throw new StationError('VALIDATION', 'Shell ID okunamadı veya boş', PLC_ERR.INVALID_DATA);
  }
  if (!input.slotNumber || input.slotNumber < 1) {
    throw new StationError('VALIDATION', 'Slot numarası okunamadı veya geçersiz', PLC_ERR.SLOT_INVALID);
  }
  const trolleyCode = getLastReadTrolleyCode();
  if (!trolleyCode) {
    throw new StationError(
      'VALIDATION',
      'Trolley Okuma istasyonunda okunmuş araba yok — önce araba okutulmalı',
      PLC_ERR.NO_ACTIVE_TROLLEY
    );
  }
  const trolley = getTrolleyByCode(trolleyCode);
  if (!trolley) {
    throw new StationError('NOT_FOUND', `Okunan araba kayıtlı değil: ${trolleyCode}`, PLC_ERR.TROLLEY_NOT_FOUND);
  }
  const product = getProductByProductId(input.shellId);
  if (!product) {
    throw new StationError('NOT_FOUND', `Shell kayıtlı değil: ${input.shellId}`, PLC_ERR.SHELL_NOT_FOUND);
  }
  if (input.slotNumber > trolley.slot_count) {
    throw new StationError(
      'VALIDATION',
      `Slot #${input.slotNumber} kapasite dışı (araba kapasitesi: ${trolley.slot_count})`,
      PLC_ERR.SLOT_INVALID
    );
  }
  // Slot başka bir shell tarafından dolu mu?
  const occupant = getTrolleySlots(trolley.id).find((o) => o.slot_number === input.slotNumber);
  if (occupant && occupant.product_id !== product.product_id) {
    throw new StationError(
      'CONFLICT',
      `#${input.slotNumber} slotu dolu (${occupant.product_id}) — önce web arayüzünden düzeltin`,
      PLC_ERR.SLOT_OCCUPIED
    );
  }
  assignTrolleySlot(trolley.id, input.slotNumber, product.product_id);
  setRuntimeTrolley(station.id, trolley.code);
  const data = { trolleyId: trolley.code, slotNumber: input.slotNumber };
  addStationRecord({
    productId: product.product_id,
    stationId: station.id,
    trolleyId: trolley.id,
    status: 'done',
    data,
    operatorId: userId ?? null,
  });
  setRuntimeCapture(station.id, { at: nowIso(), summary: `${product.product_id} → ${trolley.code}`, data });
  return { ok: true, message: `${product.product_id} → ${trolley.code} #${input.slotNumber}` };
}

/**
 * Dolum — PLC'den TrolleyId + RowNumber + Data (shell temperature vb.) gelir.
 * Veri, arabanın belirtilen SATIRINDAKİ tüm shell'lere yazılır
 * (1 satır = row_size yuva; genel ayar `row_size`, varsayılan 4; 1-tabanlı).
 */
function handleFilling(
  station: StationRow,
  input: TriggerInput,
  source: 'plc' | 'manual',
  userId?: number
): TriggerResult {
  if (!input.trolleyId) {
    throw new StationError('VALIDATION', 'Trolley ID okunamadı veya boş', PLC_ERR.INVALID_DATA);
  }
  const trolley = getTrolleyByCode(input.trolleyId);
  if (!trolley) {
    throw new StationError('NOT_FOUND', `Araba kayıtlı değil: ${input.trolleyId}`, PLC_ERR.TROLLEY_NOT_FOUND);
  }
  if (!input.rowNumber || input.rowNumber < 1) {
    throw new StationError('VALIDATION', 'Satır numarası okunamadı veya geçersiz', PLC_ERR.INVALID_DATA);
  }
  const rowSize = Number(getSetting('row_size')) || 4;
  const start = (input.rowNumber - 1) * rowSize + 1;
  const end = input.rowNumber * rowSize;
  const targets = getTrolleySlots(trolley.id).filter(
    (s) => s.slot_number >= start && s.slot_number <= end
  );
  if (targets.length === 0) {
    throw new StationError(
      'NOT_FOUND',
      `${trolley.code} arabasının ${input.rowNumber}. satırında ürün yok (slot ${start}-${end})`,
      PLC_ERR.EMPTY_TARGET
    );
  }
  setRuntimeTrolley(station.id, trolley.code);
  const record = { ...dataToRecord(input.data), row: input.rowNumber };
  for (const t of targets) {
    writeMeasurements(station, t.product_id, input.data, source);
    addStationRecord({
      productId: t.product_id,
      stationId: station.id,
      trolleyId: trolley.id,
      status: 'done',
      data: record,
      operatorId: userId ?? null,
    });
  }
  setRuntimeCapture(station.id, {
    at: nowIso(),
    summary: `${trolley.code} • Satır ${input.rowNumber} (${targets.length} ürün)`,
    data: record,
    extra: { row: input.rowNumber, count: targets.length },
  });
  return { ok: true, message: `${trolley.code} satır ${input.rowNumber}: ${targets.length} ürüne dolum verisi yazıldı` };
}

/**
 * Problama — PLC'den TrolleyId + Data (ambient temperature vb.) gelir.
 * Veri, arabadaki TÜM shell'lere yazılır.
 */
function handleProbing(
  station: StationRow,
  input: TriggerInput,
  source: 'plc' | 'manual',
  userId?: number
): TriggerResult {
  if (!input.trolleyId) {
    throw new StationError('VALIDATION', 'Trolley ID okunamadı veya boş', PLC_ERR.INVALID_DATA);
  }
  const trolley = getTrolleyByCode(input.trolleyId);
  if (!trolley) {
    throw new StationError('NOT_FOUND', `Araba kayıtlı değil: ${input.trolleyId}`, PLC_ERR.TROLLEY_NOT_FOUND);
  }
  const targets = getTrolleySlots(trolley.id);
  if (targets.length === 0) {
    throw new StationError('NOT_FOUND', `${trolley.code} arabasında ürün yok`, PLC_ERR.EMPTY_TARGET);
  }
  setRuntimeTrolley(station.id, trolley.code);
  const record = dataToRecord(input.data);
  for (const t of targets) {
    writeMeasurements(station, t.product_id, input.data, source);
    addStationRecord({
      productId: t.product_id,
      stationId: station.id,
      trolleyId: trolley.id,
      status: 'done',
      data: record,
      operatorId: userId ?? null,
    });
  }
  setRuntimeCapture(station.id, {
    at: nowIso(),
    summary: `${trolley.code} • ${targets.length} ürün`,
    data: record,
    extra: { count: targets.length },
  });
  return { ok: true, message: `${trolley.code}: ${targets.length} ürüne problama verisi yazıldı` };
}

// ─── PLC sözleşmesi okuma ───────────────────────────────────────────────────

/** Sözleşme tag'lerini PLC'den okur (ShellId/TrolleyId/SlotNumber/RowNumber/Data). */
async function readContract(plcId: number, config: StationConfig): Promise<TriggerInput> {
  const readScalar = async (tagId?: number): Promise<number | boolean | string | null> => {
    if (!tagId) return null;
    try {
      return await workerManager.readTag(plcId, tagId);
    } catch (err) {
      throw new StationError(
        'PLC_READ',
        `PLC tag'i okunamadı (#${tagId}): ${err instanceof Error ? err.message : String(err)}`,
        PLC_ERR.PLC_READ_ERROR
      );
    }
  };

  const shellRaw = await readScalar(config.shellIdTagId);
  const trolleyRaw = await readScalar(config.trolleyIdTagId);
  const slotRaw = await readScalar(config.slotTagId);
  const rowRaw = await readScalar(config.rowTagId);

  // Data/<tagAdı> ölçüm alanları — alan adı = PLC tag adı
  const data: TriggerDataItem[] = [];
  if (config.dataTagIds?.length) {
    for (const tagId of config.dataTagIds) {
      let value: number | boolean | string | null = null;
      try {
        value = await workerManager.readTag(plcId, tagId);
      } catch {
        value = null; // tek bir ölçüm okunamasa akış durmasın
      }
      data.push({ field: getTagName(tagId) ?? `tag_${tagId}`, tagId, value });
    }
  }

  const toNum = (v: number | boolean | string | null): number | undefined => {
    if (v === null || v === undefined || v === '') return undefined;
    const n = Number(v);
    return Number.isFinite(n) && n > 0 ? n : undefined;
  };

  return {
    shellId: shellRaw === null ? undefined : String(shellRaw).trim() || undefined,
    trolleyId: trolleyRaw === null ? undefined : String(trolleyRaw).trim() || undefined,
    slotNumber: toNum(slotRaw),
    rowNumber: toNum(rowRaw),
    data,
  };
}

// ─── Ana giriş noktası ──────────────────────────────────────────────────────

/**
 * İstasyon tetikleyici — PLC trigger kenarı (plc-data-watcher) veya web
 * arayüzünden manuel tetikleme (`source: 'manual'`, PLC'ye hiç yazılmaz).
 */
export async function handleStationTrigger(
  stationId: number,
  opts: { source: 'plc' | 'manual'; manual?: ManualPayload; userId?: number }
): Promise<TriggerResult> {
  const station = getStation(stationId);
  if (!station) throw new StationError('NOT_FOUND', `İstasyon bulunamadı: #${stationId}`, PLC_ERR.INVALID_DATA);
  const config = parseConfig(station.config);

  // QR Kod Üretim — PLC sözleşmesi yok
  if (station.type === 'qr_generate') {
    return handleQrGenerate(station, opts.manual?.shellId, opts.userId);
  }

  // ─── Manuel tetikleme (web'den "PLC'den gelmiş gibi" veri girişi) ───
  if (opts.source === 'manual') {
    const m = opts.manual ?? {};
    const input: TriggerInput = {
      shellId: m.shellId?.trim() || undefined,
      trolleyId: m.trolleyId?.trim() || undefined,
      slotNumber: m.slotNumber,
      rowNumber: m.rowNumber,
      data: Object.entries(m.data ?? {}).map(([field, value]) => ({
        field,
        value: value as number | string | boolean | null,
      })),
    };
    return dispatch(station, input, 'manual', opts.userId);
  }

  // ─── PLC tetikleme ───
  if (!config.plcId) {
    return { ok: false, message: 'İstasyonda PLC tanımlı değil', errorCode: PLC_ERR.INVALID_DATA };
  }
  const plcId = config.plcId;

  const write = async (tagId: number | undefined, value: number | boolean | string): Promise<void> => {
    if (!tagId) return;
    try {
      await workerManager.writeTag(plcId, tagId, value);
    } catch {
      // salt okunur tag'e yazılırsa akış durmasın
    }
  };

  // 1) Yükselen kenar: önceki çevrimin sonuçlarını temizle + Busy=true
  await write(config.ackTagId, false);
  await write(config.errorCodeTagId, 0);
  await write(config.errorMessageTagId, '');
  await write(config.busyTagId, true);

  // 2) Sonuç yazma + Busy=false + handshake (trigger=false)
  const finish = async (errorCode: number, message: string): Promise<void> => {
    await write(config.ackTagId, errorCode === PLC_ERR.NONE);
    await write(config.errorCodeTagId, errorCode);
    await write(config.errorMessageTagId, message);
    await write(config.busyTagId, false);
    await write(config.triggerTagId, false); // handshake — PLC yeniden tetikleyebilir
  };

  try {
    const input = await readContract(plcId, config);
    const result = await dispatch(station, input, 'plc');
    await finish(PLC_ERR.NONE, '');
    return result;
  } catch (err) {
    const errorCode = err instanceof StationError ? err.errorCode : PLC_ERR.INVALID_DATA;
    const message = err instanceof Error ? err.message : String(err);
    await finish(errorCode, message);
    return { ok: false, message, errorCode };
  }
}

/** Tip handler'ına yönlendirir. Hatalar StationError olarak yukarı fırlatılır. */
async function dispatch(
  station: StationRow,
  input: TriggerInput,
  source: 'plc' | 'manual',
  userId?: number
): Promise<TriggerResult> {
  switch (station.type) {
    case 'trolley_read':
      return handleTrolleyRead(station, input);
    case 'funnel_screwing':
      return handleFunnelScrewing(station, input, source, userId);
    case 'trolley_shell_matching':
      return handleMatching(station, input, source, userId);
    case 'filling':
      return handleFilling(station, input, source, userId);
    case 'probing':
      return handleProbing(station, input, source, userId);
    default:
      throw new StationError('VALIDATION', `Desteklenmeyen istasyon tipi: ${station.type}`, PLC_ERR.INVALID_DATA);
  }
}

// ─── Ürünler sayfası hızlı ürün ekleme ──────────────────────────────────────

export async function createNewProduct(userId: number): Promise<{
  product: ReturnType<typeof getProductByProductId>;
  qrLabel: QrLabelResult;
}> {
  const qrStation = listStations().find((s) => s.type === 'qr_generate' && s.is_active === 1)
    ?? listStations().find((s) => s.type === 'qr_generate');

  if (qrStation) {
    const res = await handleStationTrigger(qrStation.id, { source: 'manual', manual: {}, userId });
    return {
      product: getProductByProductId(res.qrLabel!.productId),
      qrLabel: res.qrLabel!,
    };
  }

  // QR istasyonu tanımlı değilse doğrudan üret
  const productId = generateProductId();
  createProduct({ productId, qrContent: productId });
  const { path, size } = qrToSvgPath(productId);
  return {
    product: getProductByProductId(productId),
    qrLabel: { productId, qrContent: productId, svgPath: path, size, widthMm: 50, heightMm: 30 },
  };
}
