import type { FastifyInstance } from 'fastify';
import type { IModule, ModuleOptions } from '../../core/module-system/module.interface.js';
import { archiveRoutes, auditRoutes, moduleRoutes, settingsRoutes } from './settings.routes.js';

/** Sistem Yönetimi Modülü (Faz 6): ayarlar, modül aç/kapa, DB arşivleme, audit viewer. */
const systemSettingsModule: IModule = {
  id: 'system-settings',
  name: 'System Settings',
  version: '1.0.0',

  async register(app: FastifyInstance, _options: ModuleOptions): Promise<void> {
    await app.register(settingsRoutes, { prefix: '/api/settings' });
    await app.register(moduleRoutes, { prefix: '/api/modules' });
    await app.register(archiveRoutes, { prefix: '/api/archive' });
    await app.register(auditRoutes, { prefix: '/api/audit' });
  },
};

export default systemSettingsModule;
