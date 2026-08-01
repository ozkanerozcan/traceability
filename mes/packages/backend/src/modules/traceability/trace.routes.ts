import type { FastifyInstance } from 'fastify';
import { processScan, StationError, type ScanInput } from './station.engine.js';
import {
  acknowledgeAlarm,
  createRoute,
  createStation,
  createTrolley,
  deleteStation,
  getProductByProductId,
  getProductRecords,
  getRouteSteps,
  getStationByKey,
  getStationContext,
  getTrolleyByCode,
  getTrolleySlots,
  listAlarms,
  listBatches,
  listProducts,
  listQrHistory,
  listRoutes,
  listStations,
  listTrolleys,
  logQrPrint,
  nextFreeSlot,
  parseCapabilities,
  parseConfig,
  releaseTrolley,
  setActiveTrolley,
  setRouteSteps,
  updateStation,
  updateTrolleySlotCount,
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
    capabilities: parseCapabilities(row.capabilities),
    config: parseConfig(row.config),
  };
}

function handleStationError(reply: any, err: unknown) {
  if (err instanceof StationError) {
    const status =
      err.code === 'NOT_FOUND' ? 404
      : err.code === 'VALIDATION' ? 400
      : err.code === 'PLC_CONNECTION_FAILED' ? 502
      : 409;
    return reply.code(status).send({
      statusCode: status,
      error: status === 400 ? 'Bad Request' : status === 404 ? 'Not Found' : status === 502 ? 'Bad Gateway' : 'Conflict',
      code: err.code,
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

  app.post<{ Body: { key: string; name: string; type?: string; capabilities?: string[]; config?: StationConfig } }>(
    '/stations',
    { preHandler: [app.requireRole([...CONFIG_ROLES])] },
    async (request, reply) => {
      const { key, name, type, capabilities, config } = request.body ?? {};
      if (!key || !name) {
        return reply.code(400).send({ statusCode: 400, error: 'Bad Request', message: 'key ve name gereklidir' });
      }
      try {
        const station = createStation({ key, name, type, capabilities, config });
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

  app.put<{ Params: { id: string }; Body: Partial<{ name: string; type: string; is_active: boolean; capabilities: string[]; config: StationConfig; sort_order: number }> }>(
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

  // ─── Rotalar ─────────────────────────────────────────────────────────────
  app.get('/routes', async () => ({
    routes: listRoutes().map((r) => ({
      ...r,
      isActive: r.is_active === 1,
      steps: getRouteSteps(r.id).map((s) => s.station_id),
    })),
  }));

  app.post<{ Body: { name: string; stationIds?: number[] } }>(
    '/routes',
    { preHandler: [app.requireRole([...CONFIG_ROLES])] },
    async (request, reply) => {
      const { name, stationIds } = request.body ?? {};
      if (!name) {
        return reply.code(400).send({ statusCode: 400, error: 'Bad Request', message: 'Rota adı gereklidir' });
      }
      const route = createRoute(name);
      if (stationIds?.length) setRouteSteps(route.id, stationIds);
      writeAudit({ userId: request.user.sub, username: request.user.username, action: 'create', entityType: 'trace_route', entityId: String(route.id), ipAddress: request.ip });
      return reply.code(201).send({ route });
    }
  );

  app.put<{ Params: { id: string }; Body: { stationIds?: number[] } }>(
    '/routes/:id/steps',
    { preHandler: [app.requireRole([...CONFIG_ROLES])] },
    async (request, reply) => {
      const { stationIds } = request.body ?? {};
      if (!Array.isArray(stationIds)) {
        return reply.code(400).send({ statusCode: 400, error: 'Bad Request', message: 'stationIds dizisi gereklidir' });
      }
      setRouteSteps(Number(request.params.id), stationIds);
      writeAudit({ userId: request.user.sub, username: request.user.username, action: 'update', entityType: 'trace_route', entityId: request.params.id, ipAddress: request.ip });
      return { success: true };
    }
  );

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
        const trolley = createTrolley(code, slotCount ?? 20);
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

  // ─── İstasyon çalışma bağlamı (trolley_read: araba onayı) ───────────────
  // Operatör istasyon sayfasında arabayı onaylar → AKTİF araba olur (sabit).
  app.post<{ Params: { key: string }; Body: { trolleyCode?: string } }>(
    '/stations/:key/trolley',
    async (request, reply) => {
      const station = getStationByKey(request.params.key);
      if (!station) {
        return reply.code(404).send({ statusCode: 404, error: 'Not Found', message: 'İstasyon bulunamadı' });
      }
      const code = request.body?.trolleyCode?.trim();
      if (!code) {
        return reply.code(400).send({ statusCode: 400, error: 'Bad Request', message: 'trolleyCode gereklidir' });
      }
      const trolley = getTrolleyByCode(code);
      if (!trolley) {
        return reply.code(404).send({ statusCode: 404, error: 'Not Found', message: `Araba bulunamadı: ${code}` });
      }
      // Yalnızca İLK/yükleme istasyonunda (clearOnRead !== false) önceki içerik
      // OTOMATİK temizlenir. Sonraki istasyonlar yüklü arabayı okur — temizlenmez.
      // (slot_count her durumda kalıcı — dokunulmaz.) Sonra AKTİF araba yap.
      const stConfig = parseConfig(station.config);
      if (stConfig.clearOnRead !== false) {
        releaseTrolley(trolley.id);
      }
      setActiveTrolley(station.id, trolley.id, trolley.code);
      writeAudit({ userId: request.user.sub, username: request.user.username, action: 'confirm', entityType: 'trace_trolley', entityId: trolley.code, details: { stationKey: station.key }, ipAddress: request.ip });
      return {
        ok: true,
        trolley: {
          id: trolley.id,
          code: trolley.code,
          slotCount: trolley.slot_count,
          slots: getTrolleySlots(trolley.id),
          nextFreeSlot: nextFreeSlot(trolley.id, trolley.slot_count),
        },
      };
    }
  );

  // İstasyonun mevcut çalışma bağlamı (UI geri yükleme için)
  app.get<{ Params: { key: string } }>('/stations/:key/context', async (request, reply) => {
    const station = getStationByKey(request.params.key);
    if (!station) {
      return reply.code(404).send({ statusCode: 404, error: 'Not Found', message: 'İstasyon bulunamadı' });
    }
    const ctx = getStationContext(station.id);
    let trolley = null;
    if (ctx.trolleyId) {
      const t = getTrolleyByCode(ctx.trolleyCode ?? '');
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
    return { trolley, productId: ctx.productId, lastCapture: ctx.lastCapture };
  });

  // ─── Ürünler ─────────────────────────────────────────────────────────────
  app.get<{ Querystring: { status?: string; limit?: string } }>('/products', async (request) => ({
    products: listProducts({ status: request.query.status, limit: request.query.limit ? Number(request.query.limit) : undefined }),
  }));

  app.get<{ Params: { productId: string } }>('/products/:productId', async (request, reply) => {
    const product = getProductByProductId(request.params.productId);
    if (!product) {
      return reply.code(404).send({ statusCode: 404, error: 'Not Found', message: 'Ürün bulunamadı' });
    }
    return { product, records: getProductRecords(product.product_id) };
  });

  // ─── Tarama (ana işlem noktası) ──────────────────────────────────────────
  app.post<{ Body: ScanInput }>('/scan', async (request, reply) => {
    const input = request.body;
    if (!input?.stationKey) {
      return reply.code(400).send({ statusCode: 400, error: 'Bad Request', message: 'stationKey gereklidir' });
    }
    try {
      const result = await processScan(input, request.user.sub);
      writeAudit({
        userId: request.user.sub,
        username: request.user.username,
        action: 'scan',
        entityType: 'trace_station',
        entityId: input.stationKey,
        details: { productId: result.productId, advanced: result.advanced },
        ipAddress: request.ip,
      });
      wsManager.broadcast({
        type: 'system:notification',
        payload: {
          notificationType: 'trace',
          message: result.message ?? `${input.stationKey} işlendi`,
          severity: result.alarm ? 'warning' : 'info',
        },
      });
      return result;
    } catch (err) {
      return handleStationError(reply, err);
    }
  });

  // ─── QR etiket ───────────────────────────────────────────────────────────
  app.get<{ Params: { productId: string } }>('/qr/:productId', async (request, reply) => {
    const product = getProductByProductId(request.params.productId);
    if (!product) {
      return reply.code(404).send({ statusCode: 404, error: 'Not Found', message: 'Ürün bulunamadı' });
    }
    const { path, size } = qrToSvgPath(product.qr_content ?? product.product_id);
    logQrPrint(product.product_id, product.qr_content ?? product.product_id, request.user.sub);
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

  // ─── Parti numaraları ────────────────────────────────────────────────────
  app.get<{ Querystring: { kind?: string } }>('/batches', async (request) => ({
    batches: listBatches(request.query.kind),
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
