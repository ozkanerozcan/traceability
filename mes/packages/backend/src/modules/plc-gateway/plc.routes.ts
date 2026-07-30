import type { FastifyInstance } from 'fastify';
import {
  createPlc,
  deletePlc,
  getPlc,
  listPlcs,
  setPlcActive,
  testConnection,
  testConnectionRaw,
  updatePlc,
  type PlcProfileInput,
} from './plc.service.js';
import { workerManager } from './workers/worker.manager.js';
import { writeAudit } from '../../core/audit/audit.service.js';

interface IdParams {
  id: string;
}

const WRITE_ROLES = ['admin', 'supervisor'] as const;

const VALID_SECURITY_MODES = ['None', 'Sign', 'SignAndEncrypt'];
const VALID_SECURITY_POLICIES = [
  'None',
  'Basic128Rsa15',
  'Basic256',
  'Basic256Sha256',
  'Aes128_Sha256_RsaOaep',
  'Aes256_Sha256_RsaPss',
];
const VALID_AUTH_TYPES = ['anonymous', 'username'];

function toDto(row: NonNullable<ReturnType<typeof getPlc>>) {
  return {
    id: row.id,
    name: row.name,
    protocol: row.protocol,
    host: row.host,
    port: row.port,
    unitId: row.unit_id,
    serialPort: row.serial_port,
    baudRate: row.baud_rate,
    dataBits: row.data_bits,
    stopBits: row.stop_bits,
    parity: row.parity,
    // ─── OPC UA (şifre asla dönmez) ───
    endpointUrl: row.endpoint_url,
    securityMode: row.security_mode ?? 'None',
    securityPolicy: row.security_policy ?? 'None',
    authType: row.auth_type ?? 'anonymous',
    authUsername: row.auth_username,
    hasPassword: !!row.auth_password_enc,
    sessionTimeoutMs: row.session_timeout_ms ?? 30000,
    description: row.description,
    isActive: row.is_active === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function validateInput(body: Partial<PlcProfileInput>): string | null {
  if (body.name !== undefined && body.name.trim().length === 0) {
    return 'PLC adı boş olamaz';
  }
  if (body.protocol !== undefined && !['modbus_tcp', 'modbus_rtu', 'opcua'].includes(body.protocol)) {
    return 'Geçersiz protokol — modbus_tcp, modbus_rtu veya opcua olmalı';
  }
  if (body.protocol === 'modbus_tcp' || !body.protocol) {
    if (body.host !== undefined && body.host !== null && body.host.trim().length === 0) {
      return 'TCP protokolü için host gereklidir';
    }
  }
  // ─── OPC UA doğrulamaları ───
  if (body.protocol === 'opcua') {
    if (body.endpointUrl !== undefined && body.endpointUrl !== null) {
      if (body.endpointUrl.trim().length === 0) {
        return 'OPC UA için endpoint URL gereklidir';
      }
      if (!/^opc\.tcp:\/\/.+/i.test(body.endpointUrl.trim())) {
        return 'Endpoint URL opc.tcp:// ile başlamalıdır (örn. opc.tcp://192.168.1.100:4840)';
      }
    }
    if (body.securityMode !== undefined && !VALID_SECURITY_MODES.includes(body.securityMode)) {
      return 'Geçersiz security mode — None, Sign veya SignAndEncrypt olmalı';
    }
    if (body.securityPolicy !== undefined && !VALID_SECURITY_POLICIES.includes(body.securityPolicy)) {
      return 'Geçersiz security policy';
    }
    if (body.authType !== undefined && !VALID_AUTH_TYPES.includes(body.authType)) {
      return 'Geçersiz kimlik doğrulama tipi — anonymous veya username olmalı';
    }
    if ((body.securityMode ?? 'None') !== 'None' && (body.securityPolicy ?? 'None') === 'None') {
      return 'Sign/SignAndEncrypt modunda bir security policy seçilmelidir';
    }
  }
  return null;
}

export async function plcRoutes(app: FastifyInstance): Promise<void> {
  // Tüm PLC route'ları oturum gerektirir
  app.addHook('preHandler', app.authenticate);

  // GET /api/plc — tüm profiller + worker durumları
  app.get('/', async () => {
    const plcs = listPlcs().map(toDto);
    const statuses = workerManager.getStatuses();
    return {
      plcs: plcs.map((plc) => ({
        ...plc,
        workerStatus: statuses.get(plc.id)?.status ?? 'stopped',
        workerStatusMessage: statuses.get(plc.id)?.message,
      })),
    };
  });

  // POST /api/plc — yeni profil
  app.post<{ Body: PlcProfileInput }>(
    '/',
    { preHandler: [app.requireRole([...WRITE_ROLES])] },
    async (request, reply) => {
      const body = request.body;
      if (!body?.name || !body.protocol) {
        return reply.code(400).send({ statusCode: 400, error: 'Bad Request', message: 'Ad ve protokol gereklidir' });
      }
      const validationError = validateInput(body);
      if (validationError) {
        return reply.code(400).send({ statusCode: 400, error: 'Bad Request', message: validationError });
      }
      if (body.protocol === 'modbus_tcp' && !body.host) {
        return reply.code(400).send({ statusCode: 400, error: 'Bad Request', message: 'TCP protokolü için host gereklidir' });
      }
      if (body.protocol === 'modbus_rtu' && !body.serialPort) {
        return reply.code(400).send({ statusCode: 400, error: 'Bad Request', message: 'RTU protokolü için seri port gereklidir' });
      }
      if (body.protocol === 'opcua' && !body.endpointUrl) {
        return reply.code(400).send({ statusCode: 400, error: 'Bad Request', message: 'OPC UA protokolü için endpoint URL gereklidir' });
      }

      try {
        const plc = createPlc(body);
        writeAudit({
          userId: request.user.sub,
          username: request.user.username,
          action: 'create',
          entityType: 'plc',
          entityId: String(plc.id),
          details: { name: plc.name, protocol: plc.protocol },
          ipAddress: request.ip,
        });
        return reply.code(201).send({ plc: toDto(plc) });
      } catch (err) {
        if (err instanceof Error && err.message.includes('UNIQUE')) {
          return reply.code(409).send({ statusCode: 409, error: 'Conflict', message: 'Bu isimde bir PLC profili zaten var' });
        }
        throw err;
      }
    }
  );

  // GET /api/plc/:id
  app.get<{ Params: IdParams }>('/:id', async (request, reply) => {
    const plc = getPlc(Number(request.params.id));
    if (!plc) {
      return reply.code(404).send({ statusCode: 404, error: 'Not Found', message: 'PLC bulunamadı' });
    }
    // getStatus() { status, message } objesi döner — DTO string status bekler
    const status = workerManager.getStatus(plc.id);
    return {
      plc: { ...toDto(plc), workerStatus: status.status, workerStatusMessage: status.message },
    };
  });

  // PUT /api/plc/:id
  app.put<{ Params: IdParams; Body: Partial<PlcProfileInput> }>(
    '/:id',
    { preHandler: [app.requireRole([...WRITE_ROLES])] },
    async (request, reply) => {
      const id = Number(request.params.id);
      const validationError = validateInput(request.body ?? {});
      if (validationError) {
        return reply.code(400).send({ statusCode: 400, error: 'Bad Request', message: validationError });
      }

      const plc = updatePlc(id, request.body ?? {});
      if (!plc) {
        return reply.code(404).send({ statusCode: 404, error: 'Not Found', message: 'PLC bulunamadı' });
      }

      // Çalışan worker varsa yeniden başlat (yeni konfigürasyonla)
      if (workerManager.isRunning(id)) {
        await workerManager.stop(id);
        if (plc.is_active === 1) {
          await workerManager.start(id);
        }
      }

      writeAudit({
        userId: request.user.sub,
        username: request.user.username,
        action: 'update',
        entityType: 'plc',
        entityId: String(id),
        details: request.body,
        ipAddress: request.ip,
      });
      return { plc: toDto(plc) };
    }
  );

  // DELETE /api/plc/:id
  app.delete<{ Params: IdParams }>(
    '/:id',
    { preHandler: [app.requireRole(['admin'])] },
    async (request, reply) => {
      const id = Number(request.params.id);
      const plc = getPlc(id);
      if (!plc) {
        return reply.code(404).send({ statusCode: 404, error: 'Not Found', message: 'PLC bulunamadı' });
      }

      await workerManager.stop(id);
      deletePlc(id);

      writeAudit({
        userId: request.user.sub,
        username: request.user.username,
        action: 'delete',
        entityType: 'plc',
        entityId: String(id),
        details: { name: plc.name },
        ipAddress: request.ip,
      });
      return { success: true };
    }
  );

  // POST /api/plc/:id/test — kayıtlı profil bağlantı testi
  app.post<{ Params: IdParams }>('/:id/test', async (request, reply) => {
    const id = Number(request.params.id);
    if (!getPlc(id)) {
      return reply.code(404).send({ statusCode: 404, error: 'Not Found', message: 'PLC bulunamadı' });
    }
    const result = await testConnection(id);
    return result;
  });

  // POST /api/plc/test — kaydedilmemiş profil bağlantı testi (form önizleme)
  app.post<{ Body: PlcProfileInput }>('/test', async (request, reply) => {
    const body = request.body;
    if (!body?.protocol) {
      return reply.code(400).send({ statusCode: 400, error: 'Bad Request', message: 'Protokol gereklidir' });
    }
    const result = await testConnectionRaw(body);
    return result;
  });

  // POST /api/plc/:id/start — worker başlat
  app.post<{ Params: IdParams }>(
    '/:id/start',
    { preHandler: [app.requireRole([...WRITE_ROLES])] },
    async (request, reply) => {
      const id = Number(request.params.id);
      if (!getPlc(id)) {
        return reply.code(404).send({ statusCode: 404, error: 'Not Found', message: 'PLC bulunamadı' });
      }
      setPlcActive(id, true);
      await workerManager.start(id);

      writeAudit({
        userId: request.user.sub,
        username: request.user.username,
        action: 'start',
        entityType: 'plc',
        entityId: String(id),
        ipAddress: request.ip,
      });
      return { success: true, workerStatus: workerManager.getStatus(id) };
    }
  );

  // POST /api/plc/:id/stop — worker durdur
  app.post<{ Params: IdParams }>(
    '/:id/stop',
    { preHandler: [app.requireRole([...WRITE_ROLES])] },
    async (request, reply) => {
      const id = Number(request.params.id);
      if (!getPlc(id)) {
        return reply.code(404).send({ statusCode: 404, error: 'Not Found', message: 'PLC bulunamadı' });
      }
      setPlcActive(id, false);
      await workerManager.stop(id);

      writeAudit({
        userId: request.user.sub,
        username: request.user.username,
        action: 'stop',
        entityType: 'plc',
        entityId: String(id),
        ipAddress: request.ip,
      });
      return { success: true };
    }
  );

  // GET /api/plc/:id/status — bağlantı durumu
  app.get<{ Params: IdParams }>('/:id/status', async (request, reply) => {
    const id = Number(request.params.id);
    if (!getPlc(id)) {
      return reply.code(404).send({ statusCode: 404, error: 'Not Found', message: 'PLC bulunamadı' });
    }
    return workerManager.getStatus(id);
  });
}