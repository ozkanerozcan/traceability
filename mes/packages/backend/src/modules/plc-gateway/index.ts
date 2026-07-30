import type { FastifyInstance } from 'fastify';
import type { IModule, ModuleOptions } from '../../core/module-system/module.interface.js';
import { plcRoutes } from './plc.routes.js';
import { tagRoutes } from './tag.routes.js';
import { opcuaRoutes } from './opcua.routes.js';
import { workerManager } from './workers/worker.manager.js';

/**
 * PLC Gateway Modülü: Modbus TCP/RTU + OPC UA bağlantıları, tag yönetimi,
 * worker thread tabanlı polling/subscription, canlı veri WebSocket yayını,
 * OPC UA sertifika güven yönetimi (TOFU).
 */
const plcGatewayModule: IModule = {
  id: 'plc-gateway',
  name: 'PLC Gateway',
  version: '1.1.0',

  async register(app: FastifyInstance, _options: ModuleOptions): Promise<void> {
    await app.register(plcRoutes, { prefix: '/api/plc' });
    await app.register(opcuaRoutes, { prefix: '/api/plc' });
    await app.register(tagRoutes, { prefix: '/api' });

    // Server boot: is_active=1 PLC'leri otomatik başlat
    await workerManager.startAllActive();
  },

  async onShutdown(): Promise<void> {
    await workerManager.stopAll();
  },
};

export default plcGatewayModule;
