import type { FastifyInstance } from 'fastify';
import type { IModule, ModuleOptions } from '../../core/module-system/module.interface.js';
import { permissionRoutes, userRoutes } from './user.routes.js';

/** Kullanıcı Yönetimi Modülü (Faz 6): kullanıcı CRUD + operatör rol yetkileri. */
const userManagementModule: IModule = {
  id: 'user-management',
  name: 'User Management',
  version: '1.0.0',

  async register(app: FastifyInstance, _options: ModuleOptions): Promise<void> {
    await app.register(userRoutes, { prefix: '/api/users' });
    await app.register(permissionRoutes, { prefix: '/api/permissions' });
  },
};

export default userManagementModule;
