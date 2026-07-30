import type { FastifyInstance } from 'fastify';
import {
  countAdmins,
  createUser,
  deleteUser,
  getUser,
  listPermissions,
  listUsers,
  setPermission,
  updateUser,
  PERMISSIONS,
  type UserInput,
} from './user.service.js';
import { writeAudit } from '../../core/audit/audit.service.js';
import { CORE_MODULE_IDS } from '../../shared/constants/index.js';
import type { Role, UserRow } from '../../shared/types/index.js';

interface IdParams {
  id: string;
}

const ROLES: Role[] = ['admin', 'supervisor', 'operator'];

function toDto(row: Omit<UserRow, 'password_hash'>) {
  return {
    id: row.id,
    username: row.username,
    role: row.role,
    displayName: row.display_name,
    language: row.language,
    theme: row.theme,
    isActive: row.is_active === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function userRoutes(app: FastifyInstance): Promise<void> {
  // Tüm kullanıcı işlemleri admin yetkisi gerektirir
  app.addHook('preHandler', app.requireRole(['admin']));

  // GET /api/users
  app.get('/', async () => ({ users: listUsers().map(toDto) }));

  // POST /api/users
  app.post<{ Body: UserInput }>('/', async (request, reply) => {
    const body = request.body;
    if (!body?.username || body.username.trim().length < 3) {
      return reply.code(400).send({ statusCode: 400, error: 'Bad Request', message: 'Kullanıcı adı en az 3 karakter olmalıdır' });
    }
    if (!ROLES.includes(body.role)) {
      return reply.code(400).send({ statusCode: 400, error: 'Bad Request', message: 'Geçersiz rol' });
    }
    try {
      const user = createUser({ ...body, username: body.username.trim() });
      writeAudit({
        userId: request.user.sub,
        username: request.user.username,
        action: 'create',
        entityType: 'user',
        entityId: String(user.id),
        details: { username: user.username, role: user.role },
        ipAddress: request.ip,
      });
      return reply.code(201).send({ user: toDto(user) });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes('UNIQUE')) {
        return reply.code(409).send({ statusCode: 409, error: 'Conflict', message: 'Bu kullanıcı adı zaten kullanılıyor' });
      }
      if (msg.startsWith('VALIDATION:')) {
        return reply.code(400).send({ statusCode: 400, error: 'Bad Request', message: msg.replace('VALIDATION: ', '') });
      }
      throw err;
    }
  });

  // PUT /api/users/:id
  app.put<{ Params: IdParams; Body: Partial<UserInput> }>('/:id', async (request, reply) => {
    const id = Number(request.params.id);
    const existing = getUser(id);
    if (!existing) {
      return reply.code(404).send({ statusCode: 404, error: 'Not Found', message: 'Kullanıcı bulunamadı' });
    }
    const body = request.body ?? {};
    if (body.role && !ROLES.includes(body.role)) {
      return reply.code(400).send({ statusCode: 400, error: 'Bad Request', message: 'Geçersiz rol' });
    }
    // Son admin korunur
    if (existing.role === 'admin' && body.role && body.role !== 'admin' && countAdmins() <= 1) {
      return reply.code(409).send({ statusCode: 409, error: 'Conflict', message: 'Son yöneticinin rolü değiştirilemez' });
    }
    if (body.password !== undefined && body.password.length > 0 && body.password.length < 4) {
      return reply.code(400).send({ statusCode: 400, error: 'Bad Request', message: 'Şifre en az 4 karakter olmalıdır' });
    }
    const user = updateUser(id, body);
    writeAudit({
      userId: request.user.sub,
      username: request.user.username,
      action: 'update',
      entityType: 'user',
      entityId: String(id),
      details: { role: body.role, isActive: body.isActive, passwordReset: !!body.password },
      ipAddress: request.ip,
    });
    return { user: toDto(user!) };
  });

  // DELETE /api/users/:id
  app.delete<{ Params: IdParams }>('/:id', async (request, reply) => {
    const id = Number(request.params.id);
    const existing = getUser(id);
    if (!existing) {
      return reply.code(404).send({ statusCode: 404, error: 'Not Found', message: 'Kullanıcı bulunamadı' });
    }
    if (id === request.user.sub) {
      return reply.code(409).send({ statusCode: 409, error: 'Conflict', message: 'Kendi hesabınızı silemezsiniz' });
    }
    if (existing.role === 'admin' && countAdmins() <= 1) {
      return reply.code(409).send({ statusCode: 409, error: 'Conflict', message: 'Son yönetici silinemez' });
    }
    deleteUser(id);
    writeAudit({
      userId: request.user.sub,
      username: request.user.username,
      action: 'delete',
      entityType: 'user',
      entityId: String(id),
      details: { username: existing.username },
      ipAddress: request.ip,
    });
    return { success: true };
  });
}

// ─── Yetki (role_permissions) route'ları — /api/permissions ─────────────────

export async function permissionRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', app.requireRole(['admin']));

  // GET /api/permissions
  app.get('/', async () => ({
    permissions: listPermissions().map((p) => ({
      role: p.role,
      moduleId: p.module_id,
      permission: p.permission,
      granted: p.granted === 1,
    })),
    modules: CORE_MODULE_IDS,
    permissionTypes: PERMISSIONS,
  }));

  // PUT /api/permissions — { role, moduleId, permission, granted }
  app.put<{ Body: { role?: string; moduleId?: string; permission?: string; granted?: boolean } }>(
    '/',
    async (request, reply) => {
      const { role, moduleId, permission, granted } = request.body ?? {};
      if (!role || !moduleId || !permission || granted === undefined) {
        return reply.code(400).send({ statusCode: 400, error: 'Bad Request', message: 'role, moduleId, permission ve granted gereklidir' });
      }
      if (!(CORE_MODULE_IDS as readonly string[]).includes(moduleId)) {
        return reply.code(400).send({ statusCode: 400, error: 'Bad Request', message: 'Geçersiz modül' });
      }
      if (!(PERMISSIONS as readonly string[]).includes(permission)) {
        return reply.code(400).send({ statusCode: 400, error: 'Bad Request', message: 'Geçersiz yetki tipi' });
      }
      setPermission(role, moduleId, permission, granted);
      writeAudit({
        userId: request.user.sub,
        username: request.user.username,
        action: 'update',
        entityType: 'permission',
        entityId: `${role}:${moduleId}:${permission}`,
        details: { granted },
        ipAddress: request.ip,
      });
      return { success: true };
    }
  );
}
