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
  getTrolleySlots,
  listAlarms,
  listBatches,
  listProducts,
  listRoutes,
  listStations,
  listTrolleys,
  logQrPrint,
  parseCapabilities,
  parseConfig,
  setRouteSteps,
  updateStation,
  type StationConfig,
} from './trace.service.js';
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
