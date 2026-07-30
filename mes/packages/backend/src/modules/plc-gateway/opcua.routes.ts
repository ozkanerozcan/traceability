import type { FastifyInstance } from 'fastify';
import { getPlc } from './plc.service.js';
import { OpcUaAdapter, OpcUaCertUntrustedError } from './adapters/opcua.adapter.js';
import {
  getClientCertificatePem,
  listServerCerts,
  recordPendingServerCert,
  rejectServerCert,
  trustServerCert,
} from './adapters/certificate.manager.js';
import { buildConnectionConfig, workerManager } from './workers/worker.manager.js';
import { writeAudit } from '../../core/audit/audit.service.js';

interface IdParams {
  id: string;
}

interface ThumbprintParams {
  id: string;
  thumbprint: string;
}

interface BrowseQuery {
  nodeId?: string;
}

const ADMIN_ROLES = ['admin'] as const;

/**
 * OPC UA'ya özgü endpoint'ler: adres alanı gezinme (browse) ve
 * sunucu sertifikası güven yönetimi (TOFU).
 * plc.routes.ts ile aynı /api/plc prefix'i altında kaydedilir.
 */
export async function opcuaRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', app.authenticate);

  // GET /api/plc/:id/browse?nodeId= — OPC UA adres alanı gezinme
  app.get<{ Params: IdParams; Querystring: BrowseQuery }>(
    '/:id/browse',
    async (request, reply) => {
      const id = Number(request.params.id);
      const plc = getPlc(id);
      if (!plc) {
        return reply.code(404).send({ statusCode: 404, error: 'Not Found', message: 'PLC bulunamadı' });
      }
      if (plc.protocol !== 'opcua') {
        return reply.code(400).send({ statusCode: 400, error: 'Bad Request', message: 'Browse yalnızca OPC UA profillerinde desteklenir' });
      }

      const adapter = new OpcUaAdapter(buildConnectionConfig(plc));
      try {
        await adapter.connect();
        const nodes = await adapter.browse(request.query.nodeId || undefined);
        return { nodes };
      } catch (err) {
        if (err instanceof OpcUaCertUntrustedError) {
          recordPendingServerCert(id, err.certInfo);
          return reply.code(502).send({
            statusCode: 502,
            error: 'Bad Gateway',
            message: 'Sunucu sertifikası güven onayı bekliyor',
            code: 'OPCUA_CERT_UNTRUSTED',
          });
        }
        return reply.code(502).send({
          statusCode: 502,
          error: 'Bad Gateway',
          message: err instanceof Error ? err.message : 'Browse başarısız',
          code: 'OPCUA_BROWSE_FAILED',
        });
      } finally {
        await adapter.disconnect().catch(() => undefined);
      }
    }
  );

  // GET /api/plc/:id/certificates — sunucu sertifikaları listesi
  app.get<{ Params: IdParams }>('/:id/certificates', async (request, reply) => {
    const id = Number(request.params.id);
    if (!getPlc(id)) {
      return reply.code(404).send({ statusCode: 404, error: 'Not Found', message: 'PLC bulunamadı' });
    }
    const certs = listServerCerts(id).map((row) => ({
      id: row.id,
      thumbprint: row.thumbprint,
      subject: row.subject,
      status: row.status,
      firstSeenAt: row.first_seen_at,
      decidedAt: row.decided_at,
    }));
    return { certs };
  });

  // POST /api/plc/:id/certificates/:thumbprint/trust — sertifikaya güven (admin)
  app.post<{ Params: ThumbprintParams }>(
    '/:id/certificates/:thumbprint/trust',
    { preHandler: [app.requireRole([...ADMIN_ROLES])] },
    async (request, reply) => {
      const id = Number(request.params.id);
      const plc = getPlc(id);
      if (!plc) {
        return reply.code(404).send({ statusCode: 404, error: 'Not Found', message: 'PLC bulunamadı' });
      }
      const thumbprint = decodeURIComponent(request.params.thumbprint);

      const ok = await trustServerCert(id, thumbprint, request.user.sub);
      if (!ok) {
        return reply.code(404).send({ statusCode: 404, error: 'Not Found', message: 'Sertifika bulunamadı' });
      }

      writeAudit({
        userId: request.user.sub,
        username: request.user.username,
        action: 'trust_cert',
        entityType: 'opcua_cert',
        entityId: thumbprint,
        details: { plcId: id, plcName: plc.name },
        ipAddress: request.ip,
      });

      // Çalışan worker varsa yeni güven durumuyla yeniden başlat
      if (workerManager.isRunning(id)) {
        await workerManager.stop(id);
        if (plc.is_active === 1) {
          await workerManager.start(id);
        }
      }

      return { success: true };
    }
  );

  // POST /api/plc/:id/certificates/:thumbprint/reject — sertifikayı reddet (admin)
  app.post<{ Params: ThumbprintParams }>(
    '/:id/certificates/:thumbprint/reject',
    { preHandler: [app.requireRole([...ADMIN_ROLES])] },
    async (request, reply) => {
      const id = Number(request.params.id);
      const plc = getPlc(id);
      if (!plc) {
        return reply.code(404).send({ statusCode: 404, error: 'Not Found', message: 'PLC bulunamadı' });
      }
      const thumbprint = decodeURIComponent(request.params.thumbprint);

      const ok = await rejectServerCert(id, thumbprint, request.user.sub);
      if (!ok) {
        return reply.code(404).send({ statusCode: 404, error: 'Not Found', message: 'Sertifika bulunamadı' });
      }

      writeAudit({
        userId: request.user.sub,
        username: request.user.username,
        action: 'reject_cert',
        entityType: 'opcua_cert',
        entityId: thumbprint,
        details: { plcId: id, plcName: plc.name },
        ipAddress: request.ip,
      });

      return { success: true };
    }
  );

  // GET /api/plc/:id/certificates/client — OE MES istemci sertifikasını indir
  app.get<{ Params: IdParams }>('/:id/certificates/client', async (request, reply) => {
    const id = Number(request.params.id);
    if (!getPlc(id)) {
      return reply.code(404).send({ statusCode: 404, error: 'Not Found', message: 'PLC bulunamadı' });
    }
    const pem = getClientCertificatePem();
    if (!pem) {
      return reply.code(404).send({
        statusCode: 404,
        error: 'Not Found',
        message: 'İstemci sertifikası henüz üretilmemiş — önce güvenli modda bir bağlantı deneyin',
      });
    }
    return { pem };
  });
}
