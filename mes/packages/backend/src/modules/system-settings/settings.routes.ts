import type { FastifyInstance } from 'fastify';
import { listModules, listSettings, setModuleEnabled, setSetting } from './settings.service.js';
import { archiveDatabase, getDbSizeBytes } from './archive.service.js';
import { queryAuditLog } from '../../core/audit/audit.service.js';
import { writeAudit } from '../../core/audit/audit.service.js';
import { CORE_MODULE_IDS, DB_SIZE_WARNING_BYTES } from '../../shared/constants/index.js';
import { listCollectingWorkOrders } from '../work-order/work-order.service.js';

interface IdParams {
  id: string;
}

/** Ayarlar + modüller + arşiv + audit route'ları (admin). */
export async function settingsRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', app.requireRole(['admin']));

  // GET /api/settings
  app.get('/', async () => ({
    settings: listSettings().map((s) => ({
      key: s.key,
      value: s.value,
      category: s.category,
      updatedAt: s.updated_at,
    })),
  }));

  // PUT /api/settings — { settings: { key: value, ... } }
  app.put<{ Body: { settings?: Record<string, string> } }>('/', async (request, reply) => {
    const settings = request.body?.settings;
    if (!settings || typeof settings !== 'object') {
      return reply.code(400).send({ statusCode: 400, error: 'Bad Request', message: 'settings nesnesi gereklidir' });
    }
    for (const [key, value] of Object.entries(settings)) {
      setSetting(key, String(value));
    }
    writeAudit({
      userId: request.user.sub,
      username: request.user.username,
      action: 'update',
      entityType: 'settings',
      entityId: null,
      details: { keys: Object.keys(settings) },
      ipAddress: request.ip,
    });
    return { success: true };
  });
}

export async function moduleRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', app.requireRole(['admin']));

  // GET /api/modules
  app.get('/', async () => ({
    modules: listModules().map((m) => ({
      id: m.id,
      name: m.name,
      enabled: m.enabled === 1,
      updatedAt: m.updated_at,
    })),
  }));

  // PUT /api/modules/:id — { enabled }
  app.put<{ Params: IdParams; Body: { enabled?: boolean } }>('/:id', async (request, reply) => {
    const { id } = request.params;
    const { enabled } = request.body ?? {};
    if (enabled === undefined) {
      return reply.code(400).send({ statusCode: 400, error: 'Bad Request', message: 'enabled alanı gereklidir' });
    }
    if (!(CORE_MODULE_IDS as readonly string[]).includes(id)) {
      return reply.code(404).send({ statusCode: 404, error: 'Not Found', message: 'Modül bulunamadı' });
    }
    if (!setModuleEnabled(id, enabled)) {
      return reply.code(404).send({ statusCode: 404, error: 'Not Found', message: 'Modül bulunamadı' });
    }
    writeAudit({
      userId: request.user.sub,
      username: request.user.username,
      action: enabled ? 'enable' : 'disable',
      entityType: 'module',
      entityId: id,
      ipAddress: request.ip,
    });
    // NOT: çalışan modüllerin route'ları bir sonraki sunucu başlatmada uygulanır
    return { success: true, restartRequired: true };
  });
}

export async function archiveRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', app.requireRole(['admin']));

  // GET /api/archive — durum (boyut + interlock bilgisi)
  app.get('/', async () => {
    const sizeBytes = getDbSizeBytes();
    const collecting = listCollectingWorkOrders();
    return {
      sizeBytes,
      sizeMb: Math.round((sizeBytes / (1024 * 1024)) * 10) / 10,
      warnBytes: DB_SIZE_WARNING_BYTES,
      warnExceeded: sizeBytes >= DB_SIZE_WARNING_BYTES,
      activeWorkOrders: collecting.length,
      canArchive: collecting.length === 0,
    };
  });

  // POST /api/archive — arşivlemeyi tetikle
  app.post('/', async (request, reply) => {
    try {
      const result = archiveDatabase();
      writeAudit({
        userId: request.user.sub,
        username: request.user.username,
        action: 'archive',
        entityType: 'database',
        entityId: result.archivePath,
        details: { deletedRows: result.deletedRows },
        ipAddress: request.ip,
      });
      return { success: true, deletedRows: result.deletedRows };
    } catch (err) {
      const e = err as Error & { code?: string };
      if (e.code === 'WORK_ORDER_ACTIVE') {
        return reply.code(409).send({
          statusCode: 409,
          error: 'Conflict',
          code: 'WORK_ORDER_ACTIVE',
          message: e.message,
        });
      }
      throw err;
    }
  });
}

export async function auditRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', app.requireRole(['admin']));

  // GET /api/audit?limit=&offset=&userId=&action=&entityType=&from=&to=
  app.get<{
    Querystring: {
      limit?: string;
      offset?: string;
      userId?: string;
      action?: string;
      entityType?: string;
      from?: string;
      to?: string;
    };
  }>('/', async (request) => {
    const q = request.query;
    const result = queryAuditLog({
      limit: q.limit ? Number(q.limit) : undefined,
      offset: q.offset ? Number(q.offset) : undefined,
      userId: q.userId ? Number(q.userId) : undefined,
      action: q.action || undefined,
      entityType: q.entityType || undefined,
      from: q.from || undefined,
      to: q.to || undefined,
    });
    return {
      entries: (result.rows as Record<string, unknown>[]).map((r) => ({
        id: r.id,
        userId: r.user_id,
        username: r.username,
        action: r.action,
        entityType: r.entity_type,
        entityId: r.entity_id,
        details: r.details ? JSON.parse(r.details as string) : null,
        ipAddress: r.ip_address,
        createdAt: r.created_at,
      })),
      total: result.total,
      limit: result.limit,
      offset: result.offset,
    };
  });
}
