import type { FastifyInstance } from 'fastify';
import {
  createTag,
  deleteTag,
  getTag,
  isValidAcquisitionMode,
  isValidDataType,
  isValidRegisterType,
  listTags,
  updateTag,
  type TagInput,
} from './tag.service.js';
import { getPlc } from './plc.service.js';
import { workerManager } from './workers/worker.manager.js';
import { writeAudit } from '../../core/audit/audit.service.js';

interface PlcIdParams {
  plcId: string;
}

interface IdParams {
  id: string;
}

interface ReadWriteBody {
  plcId?: number;
  tagId?: number;
  value?: number | boolean | string;
}

const WRITE_ROLES = ['admin', 'supervisor'] as const;

function toDto(row: NonNullable<ReturnType<typeof getTag>>) {
  return {
    id: row.id,
    plcId: row.plc_id,
    name: row.name,
    address: row.address,
    registerType: row.register_type,
    dataType: row.data_type,
    acquisitionMode: row.acquisition_mode,
    pollingIntervalMs: row.polling_interval_ms,
    unit: row.unit,
    description: row.description,
    wordSwap: row.word_swap === 1,
    byteSwap: row.byte_swap === 1,
    isActive: row.is_active === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function validateTagInput(
  body: Partial<TagInput>,
  partial: boolean,
  protocol: string
): string | null {
  if (!partial) {
    if (!body.name?.trim()) return 'Tag adı gereklidir';
    if (body.address === undefined || body.address === null || body.address === '') {
      return 'Adres gereklidir';
    }
    if (!body.dataType) return 'Veri tipi gereklidir';
  }
  if (body.name !== undefined && body.name.trim().length === 0) return 'Tag adı boş olamaz';

  // Adres doğrulaması protokole göre
  if (body.address !== undefined) {
    if (protocol === 'opcua') {
      if (
        typeof body.address !== 'string' ||
        !/^ns=\d+;(s|i|g|b)=.+/i.test(body.address.trim())
      ) {
        return 'Geçersiz OPC UA NodeId — örn. ns=2;s=Kanal.Cihaz.Tag veya ns=2;i=10846';
      }
    } else if (!Number.isInteger(Number(body.address)) || Number(body.address) < 0) {
      return 'Adres pozitif tam sayı olmalıdır (örn. 40001)';
    }
  }

  if (body.registerType !== undefined && !isValidRegisterType(body.registerType)) {
    return 'Geçersiz register tipi';
  }
  if (body.dataType !== undefined && !isValidDataType(body.dataType)) {
    return 'Geçersiz veri tipi';
  }
  if (body.acquisitionMode !== undefined && !isValidAcquisitionMode(body.acquisitionMode)) {
    return 'Geçersiz veri toplama modu — poll veya subscribe olmalı';
  }
  if (body.acquisitionMode === 'subscribe' && protocol !== 'opcua') {
    return 'Subscribe modu yalnızca OPC UA protokolünde desteklenir';
  }
  if (body.pollingIntervalMs !== undefined && body.pollingIntervalMs < 100) {
    return 'Polling periyodu en az 100ms olmalıdır';
  }
  return null;
}

export async function tagRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', app.authenticate);

  // GET /api/plc/:plcId/tags
  app.get<{ Params: PlcIdParams }>('/plc/:plcId/tags', async (request, reply) => {
    const plcId = Number(request.params.plcId);
    if (!getPlc(plcId)) {
      return reply.code(404).send({ statusCode: 404, error: 'Not Found', message: 'PLC bulunamadı' });
    }
    return { tags: listTags(plcId).map(toDto) };
  });

  // POST /api/plc/:plcId/tags
  app.post<{ Params: PlcIdParams; Body: TagInput }>(
    '/plc/:plcId/tags',
    { preHandler: [app.requireRole([...WRITE_ROLES])] },
    async (request, reply) => {
      const plcId = Number(request.params.plcId);
      const plc = getPlc(plcId);
      if (!plc) {
        return reply.code(404).send({ statusCode: 404, error: 'Not Found', message: 'PLC bulunamadı' });
      }

      const validationError = validateTagInput(request.body ?? {}, false, plc.protocol);
      if (validationError) {
        return reply.code(400).send({ statusCode: 400, error: 'Bad Request', message: validationError });
      }

      try {
        const tag = createTag(plcId, request.body);
        workerManager.updateTags(plcId);

        writeAudit({
          userId: request.user.sub,
          username: request.user.username,
          action: 'create',
          entityType: 'tag',
          entityId: String(tag.id),
          details: { plcId, name: tag.name, address: tag.address },
          ipAddress: request.ip,
        });
        return reply.code(201).send({ tag: toDto(tag) });
      } catch (err) {
        if (err instanceof Error && err.message.includes('UNIQUE')) {
          return reply.code(409).send({ statusCode: 409, error: 'Conflict', message: 'Bu PLC üzerinde aynı isimde bir tag zaten var' });
        }
        throw err;
      }
    }
  );

  // PUT /api/tags/:id
  app.put<{ Params: IdParams; Body: Partial<TagInput> }>(
    '/tags/:id',
    { preHandler: [app.requireRole([...WRITE_ROLES])] },
    async (request, reply) => {
      const id = Number(request.params.id);
      const existing = getTag(id);
      if (!existing) {
        return reply.code(404).send({ statusCode: 404, error: 'Not Found', message: 'Tag bulunamadı' });
      }
      const plc = getPlc(existing.plc_id);
      const validationError = validateTagInput(request.body ?? {}, true, plc?.protocol ?? 'modbus_tcp');
      if (validationError) {
        return reply.code(400).send({ statusCode: 400, error: 'Bad Request', message: validationError });
      }

      const tag = updateTag(id, request.body ?? {});
      if (!tag) {
        return reply.code(404).send({ statusCode: 404, error: 'Not Found', message: 'Tag bulunamadı' });
      }
      workerManager.updateTags(tag.plc_id);

      writeAudit({
        userId: request.user.sub,
        username: request.user.username,
        action: 'update',
        entityType: 'tag',
        entityId: String(id),
        details: request.body,
        ipAddress: request.ip,
      });
      return { tag: toDto(tag) };
    }
  );

  // DELETE /api/tags/:id
  app.delete<{ Params: IdParams }>(
    '/tags/:id',
    { preHandler: [app.requireRole([...WRITE_ROLES])] },
    async (request, reply) => {
      const id = Number(request.params.id);
      const tag = getTag(id);
      if (!tag) {
        return reply.code(404).send({ statusCode: 404, error: 'Not Found', message: 'Tag bulunamadı' });
      }

      deleteTag(id);
      workerManager.updateTags(tag.plc_id);

      writeAudit({
        userId: request.user.sub,
        username: request.user.username,
        action: 'delete',
        entityType: 'tag',
        entityId: String(id),
        details: { plcId: tag.plc_id, name: tag.name },
        ipAddress: request.ip,
      });
      return { success: true };
    }
  );

  // POST /api/tags/read — manuel tag okuma
  app.post<{ Body: ReadWriteBody }>('/tags/read', async (request, reply) => {
    const { plcId, tagId } = request.body ?? {};
    if (!plcId || !tagId) {
      return reply.code(400).send({ statusCode: 400, error: 'Bad Request', message: 'plcId ve tagId gereklidir' });
    }
    const tag = getTag(tagId);
    if (!tag || tag.plc_id !== plcId) {
      return reply.code(404).send({ statusCode: 404, error: 'Not Found', message: 'Tag bulunamadı' });
    }

    try {
      const value = await workerManager.readTag(plcId, tagId);
      return { tagId, value, timestamp: new Date().toISOString() };
    } catch (err) {
      return reply.code(503).send({
        statusCode: 503,
        error: 'Service Unavailable',
        message: err instanceof Error ? err.message : 'Okuma başarısız',
      });
    }
  });

  // POST /api/tags/write — manuel tag yazma (yalnızca admin/supervisor)
  app.post<{ Body: ReadWriteBody }>(
    '/tags/write',
    { preHandler: [app.requireRole([...WRITE_ROLES])] },
    async (request, reply) => {
      const { plcId, tagId, value } = request.body ?? {};
      if (!plcId || !tagId || value === undefined) {
        return reply.code(400).send({ statusCode: 400, error: 'Bad Request', message: 'plcId, tagId ve value gereklidir' });
      }
      const tag = getTag(tagId);
      if (!tag || tag.plc_id !== plcId) {
        return reply.code(404).send({ statusCode: 404, error: 'Not Found', message: 'Tag bulunamadı' });
      }
      const plc = getPlc(tag.plc_id);
      if (
        plc?.protocol !== 'opcua' &&
        (tag.register_type === 'input' || tag.register_type === 'discrete')
      ) {
        return reply.code(400).send({ statusCode: 400, error: 'Bad Request', message: 'Input register ve discrete input yazılamaz' });
      }

      try {
        await workerManager.writeTag(plcId, tagId, value);

        writeAudit({
          userId: request.user.sub,
          username: request.user.username,
          action: 'write',
          entityType: 'tag',
          entityId: String(tagId),
          details: { plcId, name: tag.name, value },
          ipAddress: request.ip,
        });
        return { success: true };
      } catch (err) {
        return reply.code(503).send({
          statusCode: 503,
          error: 'Service Unavailable',
          message: err instanceof Error ? err.message : 'Yazma başarısız',
        });
      }
    }
  );
}