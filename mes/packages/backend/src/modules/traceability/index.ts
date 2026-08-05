import type { FastifyInstance } from 'fastify';
import type { IModule, ModuleOptions } from '../../core/module-system/module.interface.js';
import { traceRoutes } from './trace.routes.js';
import { startPlcDataWatcher } from './plc-data-watcher.js';

/**
 * Ürün İzlenebilirliği Modülü: QR üretimi, istasyon yönetimi (sabit tipler),
 * PLC tetikleyicili veri toplama (standart sözleşme: ShellId/TrolleyId/
 * SlotNumber/RowNumber/Trigger/Data + Ack/ErrorCode/ErrorMessage/Busy),
 * ölçüm düzenleme (web'den ekle/düzenle/sil), araba eşleştirme, alarmlar.
 */
const traceabilityModule: IModule = {
  id: 'traceability',
  name: 'Product Traceability',
  version: '2.0.0',
  dependencies: ['plc-gateway'],

  async register(app: FastifyInstance, _options: ModuleOptions): Promise<void> {
    await app.register(traceRoutes, { prefix: '/api/trace' });
    // PLC trigger izleyiciyi başlat (tüm PLC'li istasyonlar)
    startPlcDataWatcher();
  },
};

export default traceabilityModule;
