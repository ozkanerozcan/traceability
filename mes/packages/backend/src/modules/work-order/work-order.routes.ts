import type { FastifyInstance } from 'fastify';
import {
  WO_STATUSES,
  canTransition,
  createWorkOrder,
  deleteWorkOrder,
  getWorkOrder,
  getWorkOrderData,
  listWorkOrders,
  transitionWorkOrder,
  updateWorkOrderNotes,
  type WorkOrderRow,
  type WorkOrderStatus,
} from './work-order.service.js';
import { dataCollector } from './data-collector.service.js';
import { getRecipe } from '../recipe/recipe.service.js';
import { writeAudit } from '../../core/audit/audit.service.js';
import { wsManager } from '../../core/websocket/ws.manager.js';

interface IdParams {
  id: string;
}

const MANAGE_ROLES = ['admin', 'supervisor'] as const;

function toDto(row: WorkOrderRow) {
  return {
    id: row.id,
    orderNumber: row.order_number,
    recipeId: row.recipe_id,
    status: row.status,
    startedAt: row.started_at,
    pausedAt: row.paused_at,
    completedAt: row.completed_at,
    createdBy: row.created_by,
    startedBy: row.started_by,
    completedBy: row.completed_by,
    notes: row.notes,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function workOrderRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', app.authenticate);

  // GET /api/work-orders?status=&recipeId=
  app.get<{ Querystring: { status?: string; recipeId?: string } }>('/', async (request) => {
    const { status, recipeId } = request.query;
    const filters: { status?: WorkOrderStatus; recipeId?: number } = {};
    if (status && (WO_STATUSES as readonly string[]).includes(status)) {
      filters.status = status as WorkOrderStatus;
    }
    if (recipeId) filters.recipeId = Number(recipeId);
    const rows = listWorkOrders(filters);
    return { workOrders: rows.map(toDto) };
  });

  // POST /api/work-orders — yeni iş emri (draft)
  app.post<{ Body: { recipeId?: number; notes?: string | null } }>(
    '/',
    { preHandler: [app.requireRole([...MANAGE_ROLES])] },
    async (request, reply) => {
      const { recipeId, notes } = request.body ?? {};
      if (!recipeId || !getRecipe(Number(recipeId))) {
        return reply.code(400).send({
          statusCode: 400,
          error: 'Bad Request',
          message: 'Geçerli bir reçete seçilmelidir',
        });
      }
      const wo = createWorkOrder({ recipeId: Number(recipeId), notes: notes ?? null }, request.user.sub);
      writeAudit({
        userId: request.user.sub,
        username: request.user.username,
        action: 'create',
        entityType: 'work_order',
        entityId: String(wo.id),
        details: { orderNumber: wo.order_number, recipeId: wo.recipe_id },
        ipAddress: request.ip,
      });
      return reply.code(201).send({ workOrder: toDto(wo) });
    }
  );

  // GET /api/work-orders/:id
  app.get<{ Params: IdParams }>('/:id', async (request, reply) => {
    const wo = getWorkOrder(Number(request.params.id));
    if (!wo) {
      return reply.code(404).send({ statusCode: 404, error: 'Not Found', message: 'İş emri bulunamadı' });
    }
    return { workOrder: toDto(wo) };
  });

  // PUT /api/work-orders/:id — notlar (yalnız draft)
  app.put<{ Params: IdParams; Body: { notes?: string | null } }>(
    '/:id',
    { preHandler: [app.requireRole([...MANAGE_ROLES])] },
    async (request, reply) => {
      const wo = getWorkOrder(Number(request.params.id));
      if (!wo) {
        return reply.code(404).send({ statusCode: 404, error: 'Not Found', message: 'İş emri bulunamadı' });
      }
      if (wo.status !== 'draft') {
        return reply.code(409).send({
          statusCode: 409,
          error: 'Conflict',
          code: 'WORK_ORDER_ACTIVE',
          message: 'Yalnızca taslak iş emirleri düzenlenebilir',
        });
      }
      const updated = updateWorkOrderNotes(wo.id, request.body?.notes ?? null);
      return { workOrder: toDto(updated!) };
    }
  );

  // DELETE /api/work-orders/:id — yalnız draft
  app.delete<{ Params: IdParams }>(
    '/:id',
    { preHandler: [app.requireRole(['admin'])] },
    async (request, reply) => {
      const wo = getWorkOrder(Number(request.params.id));
      if (!wo) {
        return reply.code(404).send({ statusCode: 404, error: 'Not Found', message: 'İş emri bulunamadı' });
      }
      if (wo.status !== 'draft') {
        return reply.code(409).send({
          statusCode: 409,
          error: 'Conflict',
          code: 'WORK_ORDER_ACTIVE',
          message: 'Yalnızca taslak iş emirleri silinebilir',
        });
      }
      deleteWorkOrder(wo.id);
      writeAudit({
        userId: request.user.sub,
        username: request.user.username,
        action: 'delete',
        entityType: 'work_order',
        entityId: String(wo.id),
        details: { orderNumber: wo.order_number },
        ipAddress: request.ip,
      });
      return { success: true };
    }
  );

  // ─── Durum geçişleri ─────────────────────────────────────────────────────

  const transitions: { path: string; to: WorkOrderStatus; action: string }[] = [
    { path: 'activate', to: 'active', action: 'start' },
    { path: 'pause', to: 'paused', action: 'pause' },
    { path: 'resume', to: 'active', action: 'resume' },
    { path: 'complete', to: 'completed', action: 'complete' },
    { path: 'archive', to: 'archived', action: 'archive' },
  ];

  for (const { path, to, action } of transitions) {
    app.post<{ Params: IdParams }>(
      `/:id/${path}`,
      { preHandler: [app.requireRole([...MANAGE_ROLES])] },
      async (request, reply) => {
        const wo = getWorkOrder(Number(request.params.id));
        if (!wo) {
          return reply.code(404).send({ statusCode: 404, error: 'Not Found', message: 'İş emri bulunamadı' });
        }
        if (!canTransition(wo.status, to)) {
          return reply.code(409).send({
            statusCode: 409,
            error: 'Conflict',
            code: 'INVALID_TRANSITION',
            message: `'${wo.status}' durumundan '${to}' durumuna geçilemez`,
          });
        }
        const updated = transitionWorkOrder(wo.id, to, request.user.sub)!;
        dataCollector.onStatusChanged(wo.id, to);
        writeAudit({
          userId: request.user.sub,
          username: request.user.username,
          action,
          entityType: 'work_order',
          entityId: String(wo.id),
          details: { orderNumber: wo.order_number, from: wo.status, to },
          ipAddress: request.ip,
        });
        wsManager.broadcast({
          type: 'workorder:changed',
          payload: { workOrderId: wo.id, status: to, changedBy: request.user.username },
        });
        return { workOrder: toDto(updated) };
      }
    );
  }

  // GET /api/work-orders/:id/data?tagIds=1,2&limit=
  app.get<{ Params: IdParams; Querystring: { tagIds?: string; limit?: string } }>(
    '/:id/data',
    async (request, reply) => {
      const wo = getWorkOrder(Number(request.params.id));
      if (!wo) {
        return reply.code(404).send({ statusCode: 404, error: 'Not Found', message: 'İş emri bulunamadı' });
      }
      const tagIds = request.query.tagIds
        ? request.query.tagIds.split(',').map(Number).filter((n) => Number.isFinite(n))
        : undefined;
      const limit = request.query.limit ? Number(request.query.limit) : undefined;
      const rows = getWorkOrderData(wo.id, { tagIds, limit });
      return {
        data: rows.map((r) => ({
          timestamp: r.timestamp,
          tagId: r.tag_id,
          value: r.value,
          valueText: r.value_text,
          quality: r.quality,
        })),
      };
    }
  );
}
