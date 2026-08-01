import type { FastifyInstance } from 'fastify';
import type { IModule, ModuleOptions } from '../../core/module-system/module.interface.js';
import { traceRoutes } from './trace.routes.js';
import { startPlcDataWatcher } from './plc-data-watcher.js';

/**
 * Ürün İzlenebilirliği Modülü: QR üretimi, istasyon/rota yönetimi, araba okuma,
 * PLC veri toplama (trigger'lı), OK/NOK, bekleme kontrolü, parti bağlama, alarmlar.
 * Capability bazlı istasyon motoru + task management (rota takibi).
 */
const traceabilityModule: IModule = {
  id: 'traceability',
  name: 'Product Traceability',
  version: '1.1.0',
  dependencies: ['plc-gateway'],

  async register(app: FastifyInstance, _options: ModuleOptions): Promise<void> {
    await app.register(traceRoutes, { prefix: '/api/trace' });
    // PLC Data tetikleyici izleyiciyi başlat (plc_acquire trigger bitleri)
    startPlcDataWatcher();
  },
};

export default traceabilityModule;
