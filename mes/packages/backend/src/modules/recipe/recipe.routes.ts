import type { FastifyInstance } from 'fastify';
import {
  createRecipe,
  deleteRecipe,
  getRecipe,
  getRecipeStats,
  isValidWidgetType,
  listRecipes,
  saveDashboardLayout,
  updateRecipe,
  type RecipeInput,
  type RecipeRow,
} from './recipe.service.js';
import { writeAudit } from '../../core/audit/audit.service.js';

interface IdParams {
  id: string;
}

const WRITE_ROLES = ['admin', 'supervisor'] as const;

/** Dashboard layout JSON doğrulama — gevşek şema: { widgets: [...] } */
function isValidDashboardLayout(value: unknown): value is { widgets: unknown[] } {
  if (typeof value !== 'object' || value === null) return false;
  const widgets = (value as { widgets?: unknown }).widgets;
  if (!Array.isArray(widgets)) return false;
  return widgets.every((w) => {
    if (typeof w !== 'object' || w === null) return false;
    const widget = w as Record<string, unknown>;
    return (
      typeof widget.id === 'string' &&
      typeof widget.type === 'string' &&
      isValidWidgetType(widget.type) &&
      typeof widget.layout === 'object' &&
      widget.layout !== null
    );
  });
}

function parseLayout(json: string | null): unknown | null {
  if (!json) return null;
  try {
    return JSON.parse(json);
  } catch {
    return null;
  }
}

function toDto(row: RecipeRow, stats?: { activeWorkOrders: number; totalWorkOrders: number }) {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    dashboardLayout: parseLayout(row.dashboard_layout),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    ...(stats ?? {}),
  };
}

export async function recipeRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', app.authenticate);

  // GET /api/recipes — tüm reçeteler + iş emri istatistikleri
  app.get('/', async () => {
    const recipes = listRecipes().map((row) =>
      toDto(row, {
        activeWorkOrders: row.active_work_orders,
        totalWorkOrders: row.total_work_orders,
      })
    );
    return { recipes };
  });

  // POST /api/recipes — yeni reçete
  app.post<{ Body: RecipeInput }>(
    '/',
    { preHandler: [app.requireRole([...WRITE_ROLES])] },
    async (request, reply) => {
      const body = request.body;
      if (!body?.name || body.name.trim().length === 0) {
        return reply.code(400).send({ statusCode: 400, error: 'Bad Request', message: 'Reçete adı gereklidir' });
      }

      try {
        const recipe = createRecipe({ name: body.name.trim(), description: body.description ?? null });
        writeAudit({
          userId: request.user.sub,
          username: request.user.username,
          action: 'create',
          entityType: 'recipe',
          entityId: String(recipe.id),
          details: { name: recipe.name },
          ipAddress: request.ip,
        });
        return reply.code(201).send({ recipe: toDto(recipe, getRecipeStats(recipe.id)) });
      } catch (err) {
        if (err instanceof Error && err.message.includes('UNIQUE')) {
          return reply.code(409).send({ statusCode: 409, error: 'Conflict', message: 'Bu isimde bir reçete zaten var' });
        }
        throw err;
      }
    }
  );

  // GET /api/recipes/:id — detay (dashboard layout dahil)
  app.get<{ Params: IdParams }>('/:id', async (request, reply) => {
    const id = Number(request.params.id);
    const recipe = getRecipe(id);
    if (!recipe) {
      return reply.code(404).send({ statusCode: 404, error: 'Not Found', message: 'Reçete bulunamadı' });
    }
    return { recipe: toDto(recipe, getRecipeStats(id)) };
  });

  // PUT /api/recipes/:id — ad/açıklama güncelle
  app.put<{ Params: IdParams; Body: Partial<RecipeInput> }>(
    '/:id',
    { preHandler: [app.requireRole([...WRITE_ROLES])] },
    async (request, reply) => {
      const id = Number(request.params.id);
      const body = request.body ?? {};
      if (!getRecipe(id)) {
        return reply.code(404).send({ statusCode: 404, error: 'Not Found', message: 'Reçete bulunamadı' });
      }
      if (body.name !== undefined && body.name.trim().length === 0) {
        return reply.code(400).send({ statusCode: 400, error: 'Bad Request', message: 'Reçete adı boş olamaz' });
      }

      try {
        const recipe = updateRecipe(id, {
          ...(body.name !== undefined ? { name: body.name.trim() } : {}),
          ...(body.description !== undefined ? { description: body.description } : {}),
        });
        writeAudit({
          userId: request.user.sub,
          username: request.user.username,
          action: 'update',
          entityType: 'recipe',
          entityId: String(id),
          details: body,
          ipAddress: request.ip,
        });
        return { recipe: toDto(recipe!, getRecipeStats(id)) };
      } catch (err) {
        if (err instanceof Error && err.message.includes('UNIQUE')) {
          return reply.code(409).send({ statusCode: 409, error: 'Conflict', message: 'Bu isimde bir reçete zaten var' });
        }
        throw err;
      }
    }
  );

  // DELETE /api/recipes/:id
  app.delete<{ Params: IdParams }>(
    '/:id',
    { preHandler: [app.requireRole(['admin'])] },
    async (request, reply) => {
      const id = Number(request.params.id);
      const recipe = getRecipe(id);
      if (!recipe) {
        return reply.code(404).send({ statusCode: 404, error: 'Not Found', message: 'Reçete bulunamadı' });
      }

      // ─── Koruma: iş emri geçmişi olan reçete silinemez ───
      const stats = getRecipeStats(id);
      if (stats.totalWorkOrders > 0) {
        return reply.code(409).send({
          statusCode: 409,
          error: 'Conflict',
          code: 'RECIPE_IN_USE',
          message: `Bu reçeteye ait ${stats.totalWorkOrders} iş emri olduğu için silinemez`,
        });
      }

      deleteRecipe(id);
      writeAudit({
        userId: request.user.sub,
        username: request.user.username,
        action: 'delete',
        entityType: 'recipe',
        entityId: String(id),
        details: { name: recipe.name },
        ipAddress: request.ip,
      });
      return { success: true };
    }
  );

  // PUT /api/recipes/:id/dashboard — dashboard layout kaydet
  // (widget ↔ PLC tag bağlantıları layout JSON'u içinde taşınır)
  app.put<{ Params: IdParams; Body: { layout: unknown } }>(
    '/:id/dashboard',
    { preHandler: [app.requireRole([...WRITE_ROLES])] },
    async (request, reply) => {
      const id = Number(request.params.id);
      if (!getRecipe(id)) {
        return reply.code(404).send({ statusCode: 404, error: 'Not Found', message: 'Reçete bulunamadı' });
      }
      const layout = request.body?.layout;
      if (!isValidDashboardLayout(layout)) {
        return reply.code(400).send({
          statusCode: 400,
          error: 'Bad Request',
          message: 'Geçersiz dashboard layout — { widgets: [{ id, type, layout, ... }] } bekleniyor',
        });
      }

      const recipe = saveDashboardLayout(id, layout);
      writeAudit({
        userId: request.user.sub,
        username: request.user.username,
        action: 'update',
        entityType: 'recipe',
        entityId: String(id),
        details: { dashboard: true, widgetCount: layout.widgets.length },
        ipAddress: request.ip,
      });
      return { recipe: toDto(recipe!, getRecipeStats(id)) };
    }
  );
}
