import type { FastifyInstance } from 'fastify';
import type { IModule, ModuleOptions } from '../../core/module-system/module.interface.js';
import { traceRoutes } from './trace.routes.js';

/**
 * Ürün İzlenebilirliği Modülü: QR üretimi, istasyon/rota yönetimi, araba atama,
 * PLC veri toplama, OK/NOK, bekleme kontrolü, parti bağlama, alarmlar.
 * Capability bazlı istasyon motoru + task management (rota takibi).
 */
const traceabilityModule: IModule = {
  id: 'traceability',
  name: 'Product Traceability',
  version: '1.0.0',
  dependencies: ['plc-gateway'],

  async register(app: FastifyInstance, _options: ModuleOptions): Promise<void> {
    await app.register(traceRoutes, { prefix: '/api/trace' });
  },
};

export default traceabilityModule;
