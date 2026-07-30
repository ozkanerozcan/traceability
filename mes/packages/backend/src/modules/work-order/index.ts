import type { FastifyInstance } from 'fastify';
import type { IModule, ModuleOptions } from '../../core/module-system/module.interface.js';
import { workOrderRoutes } from './work-order.routes.js';
import { dataCollector } from './data-collector.service.js';

/**
 * İş Emri Yönetimi Modülü (Faz 4): iş emri CRUD, WO-YYYYMMDD-NNN numaralandırma,
 * durum makinesi (draft→active→paused→completed→archived), DataCollector ile
 * aktif iş emirleri için PLC veri kaydı (transaction batching).
 */
const workOrderModule: IModule = {
  id: 'work-order',
  name: 'Work Order Management',
  version: '1.0.0',
  dependencies: ['recipe', 'plc-gateway'],

  async register(app: FastifyInstance, _options: ModuleOptions): Promise<void> {
    await app.register(workOrderRoutes, { prefix: '/api/work-orders' });
    // Boot'ta active/paused iş emirleri için veri toplamaya devam et
    dataCollector.start();
  },

  async onShutdown(): Promise<void> {
    dataCollector.stop();
  },
};

export default workOrderModule;
