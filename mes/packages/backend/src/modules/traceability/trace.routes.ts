import type { FastifyInstance } from 'fastify';
import { createNewProduct, handleStationTrigger, StationError, type ManualPayload } from './station.engine.js';
import { getSetting } from '../system-settings/settings.service.js';
import {
  acknowledgeAlarm,
  createStation,
  createTrolley,
  deleteMeasurement,
  deleteProduct,
  deleteStation,
  deleteTrolley,
  generateProductId,
  getLastCapture,
  getLastReadTrolleyCode,
  getProduct,
  getProductByProductId,
  getProductRecords,
  getRuntime,
  getStationByKey,
  getTrolley,
  getTrolleyByCode,
  getTrolleyProductItems,
  getTrolleySlots,
  listAlarms,
  listMeasurements,
  listProducts,
  listQrHistory,
  listStationMeasurements,
  listStations,
  listTrolleys,
  nextFreeSlot,
  parseConfig,
  updateMeasurement,
  updateStation,
  updateTrolleySlotCount,
  upsertMeasurement,
  type StationConfig,
} from './trace.service.js';
import { reloadPlcDataWatches } from './plc-data-watcher.js';
import { qrToSvgPath } from './qr/qrcode.js';
import { writeAudit } from '../../core/audit/audit.service.js';
import { wsManager } from '../../core/websocket/ws.manager.js';

const CONFIG_ROLES = ['admin', 'supervisor'] as const;

function stationDto(row: ReturnType<typeof getStationByKey>) {
  if (!row) return null;
  return {
    id: row.id,
    key: row.key,
    name: row.name,
    type: row.type,
    sortOrder: row.sort_order,
    isActive: row.is_active === 1,
    config: parseConfig(row.config),
  };
}

function measurementDto(m: {
  id: number; shell_id: string; station_key: string; field: string;
  tag_id: number | null; value_num: number | null; value_text: string | null;
  source: string; created_at: string; updated_at: string;
}) {
  return {
    id: m.id,
    shellId: m.shell_id,
    stationKey: m.station_key,
    field: m.field,
    tagId: m.tag_id,
    value: m.value_num ?? m.value_text,
    source: m.source,
    createdAt: m.created_at,
    updatedAt: m.updated_at,
  };
}

function handleStationError(reply: any, err: unknown) {
  if (err instanceof StationError) {
    const status =
      err.code === 'NOT_FOUND' ? 404
      : err.code === 'VALIDATION' ? 400
      : err.code === 'PLC_READ' ? 502
      : 409;
    return reply.code(status).send({
      statusCode: status,
      error: status === 400 ? 'Bad Request' : status === 404 ? 'Not Found' : status === 502 ? 'Bad Gateway' : 'Conflict',
      code: err.code,
      errorCode: err.errorCode,
      message: err.message,
      details: err.details,
    });
  }
  throw err;
}

export async function traceRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', app.authenticate);

  // ─── İstasyonlar ─────────────────────────────────────────────────────────
  app.get('/stations', async () => ({
    stations: listStations().map((s) => stationDto(s)),
  }));

  app.post<{ Body: { key: string; name: string; type?: string; config?: StationConfig } }>(
    '/stations',
    { preHandler: [app.requireRole([...CONFIG_ROLES])] },
    async (request, reply) => {
      const { key, name, type, config } = request.body ?? {};
      if (!key || !name) {
        return reply.code(400).send({ statusCode: 400, error: 'Bad Request', message: 'key ve name gereklidir' });
      }
      try {
        const station = createStation({ key, name, type, config });
        reloadPlcDataWatches();
        writeAudit({ userId: request.user.sub, username: request.user.username, action: 'create', entityType: 'trace_station', entityId: key, ipAddress: request.ip });
        return reply.code(201).send({ station: stationDto(station) });
      } catch (err) {
        if (err instanceof Error && err.message.includes('UNIQUE')) {
          return reply.code(409).send({ statusCode: 409, error: 'Conflict', message: 'Bu key ile bir istasyon zaten var' });
        }
        throw err;
      }
    }
  );

  app.put<{ Params: { id: string }; Body: Partial<{ name: string; type: string; is_active: boolean; config: StationConfig; sort_order: number }> }>(
    '/stations/:id',
    { preHandler: [app.requireRole([...CONFIG_ROLES])] },
    async (request, reply) => {
      const station = updateStation(Number(request.params.id), request.body ?? {});
      if (!station) {
        return reply.code(404).send({ statusCode: 404, error: 'Not Found', message: 'İstasyon bulunamadı' });
      }
      reloadPlcDataWatches();
      writeAudit({ userId: request.user.sub, username: request.user.username, action: 'update', entityType: 'trace_station', entityId: request.params.id, ipAddress: request.ip });
      return { station: stationDto(station) };
    }
  );

  app.delete<{ Params: { id: string } }>(
    '/stations/:id',
    { preHandler: [app.requireRole(['admin'])] },
    async (request, reply) => {
      if (!deleteStation(Number(request.params.id))) {
        return reply.code(404).send({ statusCode: 404, error: 'Not Found', message: 'İstasyon bulunamadı' });
      }
      writeAudit({ userId: request.user.sub, username: request.user.username, action: 'delete', entityType: 'trace_station', entityId: request.params.id, ipAddress: request.ip });
      return { success: true };
    }
  );

  // ─── İstasyon tetikleme (manuel — "PLC'den gelmiş gibi" veri girişi) ─────
  // PLC'li istasyonlarla AYNI handler'lar çalışır; PLC tag okuma/yazma yapılmaz.
  app.post<{ Params: { key: string }; Body: ManualPayload }>(
    '/stations/:key/trigger',
    async (request, reply) => {
      const station = getStationByKey(request.params.key);
      if (!station) {
        return reply.code(404).send({ statusCode: 404, error: 'Not Found', message: 'İstasyon bulunamadı' });
      }
      try {
        const result = await handleStationTrigger(station.id, {
          source: 'manual',
          manual: request.body ?? {},
          userId: request.user.sub,
        });
        writeAudit({
          userId: request.user.sub,
          username: request.user.username,
          action: 'manual_trigger',
          entityType: 'trace_station',
          entityId: station.key,
          details: { ...(request.body ?? {}), message: result.message },
          ipAddress: request.ip,
        });
        wsManager.broadcast({
          type: 'system:notification',
          payload: { notificationType: 'trace', message: result.message ?? `${station.name} işlendi`, severity: 'info' },
        });
        return result;
      } catch (err) {
        return handleStationError(reply, err);
      }
    }
  );

  // ─── İstasyon çalışma bağlamı (runtime — DB'de kalıcı) ───────────────────
  // İstasyonun son okuduğu arabayı + son yakaladığı veriyi döndürür.
  // Trolley-Shell Eşleştirme istasyonunda araba, Trolley Okuma'nın kaydettiği
  // son arabadan alınır.
  app.get<{ Params: { key: string } }>('/stations/:key/context', async (request, reply) => {
    const station = getStationByKey(request.params.key);
    if (!station) {
      return reply.code(404).send({ statusCode: 404, error: 'Not Found', message: 'İstasyon bulunamadı' });
    }

    const runtime = getRuntime(station.id);
    // Eşleştirme istasyonu: kendi runtime'ı yoksa Trolley Okuma'nın son arabası
    const trolleyCode =
      runtime.trolley_id ??
      (station.type === 'trolley_shell_matching' ? getLastReadTrolleyCode() : null);

    let trolley = null;
    if (trolleyCode) {
      const t = getTrolleyByCode(trolleyCode);
      if (t) {
        trolley = {
          id: t.id,
          code: t.code,
          slotCount: t.slot_count,
          slots: getTrolleySlots(t.id),
          nextFreeSlot: nextFreeSlot(t.id, t.slot_count),
        };
      }
    }
    const trolleyItems = trolley ? getTrolleyProductItems(trolley.id) : [];
    return { trolley, trolleyItems, lastCapture: getLastCapture(station.id) };
  });

  // ─── Ölçümler (web'den görüntüleme/ekleme/düzenleme/silme) ───────────────

  // Bir shell'in ölçümleri (isteğe bağlı istasyon filtresi)
  app.get<{ Params: { productId: string }; Querystring: { stationKey?: string } }>(
    '/shells/:productId/measurements',
    async (request) => ({
      measurements: listMeasurements(request.params.productId, request.query.stationKey).map(measurementDto),
    })
  );

  // Bir istasyonun son ölçümleri (istasyon sayfası "son ölçümler" listesi)
  app.get<{ Params: { key: string }; Querystring: { limit?: string } }>(
    '/stations/:key/measurements',
    async (request) => ({
      measurements: listStationMeasurements(
        request.params.key,
        request.query.limit ? Number(request.query.limit) : 20
      ).map(measurementDto),
    })
  );

  // Manuel ölçüm girişi (PLC'den gelmemiş veriyi web'den doldurma)
  app.post<{ Body: { shellId?: string; stationKey?: string; field?: string; value?: number | string } }>(
    '/measurements',
    async (request, reply) => {
      const { shellId, stationKey, field, value } = request.body ?? {};
      if (!shellId?.trim() || !stationKey?.trim() || !field?.trim() || value === undefined || value === null || value === '') {
        return reply.code(400).send({ statusCode: 400, error: 'Bad Request', message: 'shellId, stationKey, field ve value gereklidir' });
      }
      const product = getProductByProductId(shellId.trim());
      if (!product) {
        return reply.code(404).send({ statusCode: 404, error: 'Not Found', message: `Shell kayıtlı değil: ${shellId}` });
      }
      const station = getStationByKey(stationKey.trim());
      if (!station) {
        return reply.code(404).send({ statusCode: 404, error: 'Not Found', message: `İstasyon bulunamadı: ${stationKey}` });
      }
      const num = typeof value === 'string' ? Number(value) : NaN;
      const finalValue = typeof value === 'number' ? value : Number.isFinite(num) && value.trim() !== '' ? num : String(value);
      upsertMeasurement({
        shellId: product.product_id,
        stationKey: station.key,
        field: field.trim(),
        value: finalValue,
        source: 'manual',
      });
      writeAudit({
        userId: request.user.sub,
        username: request.user.username,
        action: 'create',
        entityType: 'trace_measurement',
        entityId: `${product.product_id}/${station.key}/${field.trim()}`,
        details: { value: finalValue },
        ipAddress: request.ip,
      });
      const list = listMeasurements(product.product_id, station.key).map(measurementDto);
      return reply.code(201).send({ ok: true, measurements: list });
    }
  );

  // Ölçüm düzenleme
  app.put<{ Params: { id: string }; Body: { value?: number | string } }>(
    '/measurements/:id',
    async (request, reply) => {
      const { value } = request.body ?? {};
      if (value === undefined || value === null || value === '') {
        return reply.code(400).send({ statusCode: 400, error: 'Bad Request', message: 'value gereklidir' });
      }
      const num = typeof value === 'string' ? Number(value) : NaN;
      const finalValue = typeof value === 'number' ? value : Number.isFinite(num) && String(value).trim() !== '' ? num : String(value);
      const updated = updateMeasurement(Number(request.params.id), finalValue);
      if (!updated) {
        return reply.code(404).send({ statusCode: 404, error: 'Not Found', message: 'Ölçüm bulunamadı' });
      }
      writeAudit({
        userId: request.user.sub,
        username: request.user.username,
        action: 'update',
        entityType: 'trace_measurement',
        entityId: request.params.id,
        details: { value: finalValue },
        ipAddress: request.ip,
      });
      return { measurement: measurementDto(updated) };
    }
  );

  // Ölçüm silme
  app.delete<{ Params: { id: string } }>('/measurements/:id', async (request, reply) => {
    const deleted = deleteMeasurement(Number(request.params.id));
    if (!deleted) {
      return reply.code(404).send({ statusCode: 404, error: 'Not Found', message: 'Ölçüm bulunamadı' });
    }
    writeAudit({
      userId: request.user.sub,
      username: request.user.username,
      action: 'delete',
      entityType: 'trace_measurement',
      entityId: `${deleted.shell_id}/${deleted.station_key}/${deleted.field}`,
      ipAddress: request.ip,
    });
    return { success: true };
  });

  // ─── Arabalar ────────────────────────────────────────────────────────────
  app.get('/trolleys', async () => ({
    trolleys: listTrolleys().map((t) => ({
      id: t.id,
      code: t.code,
      slotCount: t.slot_count,
      isActive: t.is_active === 1,
      slots: getTrolleySlots(t.id),
    })),
  }));

  app.post<{ Body: { code: string; slotCount?: number } }>(
    '/trolleys',
    { preHandler: [app.requireRole([...CONFIG_ROLES])] },
    async (request, reply) => {
      const { code, slotCount } = request.body ?? {};
      if (!code) {
        return reply.code(400).send({ statusCode: 400, error: 'Bad Request', message: 'Araba kodu gereklidir' });
      }
      try {
        const defaultCap = Number(getSetting('trolley_capacity')) || 20;
        const trolley = createTrolley(code, slotCount ?? defaultCap);
        writeAudit({ userId: request.user.sub, username: request.user.username, action: 'create', entityType: 'trace_trolley', entityId: code, ipAddress: request.ip });
        return reply.code(201).send({ trolley });
      } catch (err) {
        if (err instanceof Error && err.message.includes('UNIQUE')) {
          return reply.code(409).send({ statusCode: 409, error: 'Conflict', message: 'Bu kod ile bir araba zaten var' });
        }
        throw err;
      }
    }
  );

  // Araba kapasitesi (slot_count) güncelle — kalıcıdır, içerik sıfırlamada silinmez
  app.put<{ Params: { id: string }; Body: { slotCount?: number } }>(
    '/trolleys/:id',
    { preHandler: [app.requireRole([...CONFIG_ROLES])] },
    async (request, reply) => {
      const slotCount = Number(request.body?.slotCount);
      if (!Number.isFinite(slotCount) || slotCount < 1) {
        return reply.code(400).send({ statusCode: 400, error: 'Bad Request', message: 'Geçerli bir slotCount gereklidir (>=1)' });
      }
      const trolley = updateTrolleySlotCount(Number(request.params.id), slotCount);
      if (!trolley) {
        return reply.code(404).send({ statusCode: 404, error: 'Not Found', message: 'Araba bulunamadı' });
      }
      writeAudit({ userId: request.user.sub, username: request.user.username, action: 'update', entityType: 'trace_trolley', entityId: request.params.id, details: { slotCount }, ipAddress: request.ip });
      return { trolley: { id: trolley.id, code: trolley.code, slotCount: trolley.slot_count, isActive: trolley.is_active === 1, slots: getTrolleySlots(trolley.id) } };
    }
  );

  app.delete<{ Params: { id: string } }>(
    '/trolleys/:id',
    { preHandler: [app.requireRole([...CONFIG_ROLES])] },
    async (request, reply) => {
      const id = Number(request.params.id);
      const trolley = getTrolley(id);
      if (!trolley) {
        return reply.code(404).send({ statusCode: 404, error: 'Not Found', message: 'Araba bulunamadı' });
      }
      const ok = deleteTrolley(id);
      if (!ok) {
        return reply.code(404).send({ statusCode: 404, error: 'Not Found', message: 'Araba silinemedi' });
      }
      writeAudit({
        userId: request.user.sub,
        username: request.user.username,
        action: 'delete',
        entityType: 'trace_trolley',
        entityId: trolley.code,
        ipAddress: request.ip,
      });
      return reply.send({ success: true });
    }
  );

  // ─── Ürünler ─────────────────────────────────────────────────────────────
  app.post('/products', async (request, reply) => {
    const result = await createNewProduct(request.user.sub);
    writeAudit({
      userId: request.user.sub,
      username: request.user.username,
      action: 'create',
      entityType: 'trace_product',
      entityId: result.product!.product_id,
      ipAddress: request.ip,
    });
    return reply.status(201).send(result);
  });

  app.get<{ Querystring: { status?: string; limit?: string } }>('/products', async (request) => ({
    products: listProducts({ status: request.query.status, limit: request.query.limit ? Number(request.query.limit) : undefined }),
  }));

  app.get<{ Params: { productId: string } }>('/products/:productId', async (request, reply) => {
    const product = getProductByProductId(request.params.productId);
    if (!product) {
      return reply.code(404).send({ statusCode: 404, error: 'Not Found', message: 'Ürün bulunamadı' });
    }
    return {
      product,
      records: getProductRecords(product.product_id),
      measurements: listMeasurements(product.product_id).map(measurementDto),
    };
  });

  app.delete<{ Params: { id: string } }>('/products/:id', async (request, reply) => {
    const id = Number(request.params.id);
    const product = getProduct(id);
    if (!product) {
      return reply.code(404).send({ statusCode: 404, error: 'Not Found', message: 'Ürün bulunamadı' });
    }
    const ok = deleteProduct(id);
    if (!ok) {
      return reply.code(404).send({ statusCode: 404, error: 'Not Found', message: 'Ürün silinemedi' });
    }
    writeAudit({
      userId: request.user.sub,
      username: request.user.username,
      action: 'delete',
      entityType: 'trace_product',
      entityId: product.product_id,
      ipAddress: request.ip,
    });
    return reply.send({ success: true });
  });

  app.get('/next-shell-id', async () => ({
    shellId: generateProductId(),
  }));

  // ─── QR etiket ───────────────────────────────────────────────────────────
  app.get<{ Params: { productId: string } }>('/qr/:productId', async (request, reply) => {
    const product = getProductByProductId(request.params.productId);
    if (!product) {
      return reply.code(404).send({ statusCode: 404, error: 'Not Found', message: 'Ürün bulunamadı' });
    }
    const { path, size } = qrToSvgPath(product.qr_content ?? product.product_id);
    return { productId: product.product_id, svgPath: path, size };
  });

  // ─── QR geçmişi (son üretilen QR'lar — önizleme/yeniden yazdırma) ───────
  app.get<{ Querystring: { limit?: string } }>('/qr-history', async (request) => ({
    items: listQrHistory(request.query.limit ? Number(request.query.limit) : 24).map((p) => {
      const content = p.qr_content ?? p.product_id;
      const { path, size } = qrToSvgPath(content);
      return {
        productId: p.product_id,
        qrContent: content,
        svgPath: path,
        size,
        status: p.status,
        createdAt: (p as { created_at?: string }).created_at ?? null,
      };
    }),
  }));

  // ─── Alarmlar ────────────────────────────────────────────────────────────
  app.get<{ Querystring: { activeOnly?: string; limit?: string } }>('/alarms', async (request) => ({
    alarms: listAlarms({
      activeOnly: request.query.activeOnly === 'true',
      limit: request.query.limit ? Number(request.query.limit) : undefined,
    }),
  }));

  app.post<{ Params: { id: string } }>('/alarms/:id/ack', async (request, reply) => {
    acknowledgeAlarm(Number(request.params.id), request.user.sub);
    writeAudit({ userId: request.user.sub, username: request.user.username, action: 'ack', entityType: 'trace_alarm', entityId: request.params.id, ipAddress: request.ip });
    return { success: true };
  });
}
