import type { FastifyInstance } from 'fastify';
import type { IModule, ModuleOptions } from '../../core/module-system/module.interface.js';
import { recipeRoutes } from './recipe.routes.js';

/**
 * Reçete Yönetimi Modülü: reçete CRUD, PLC tag eşleştirmesi,
 * dashboard template layout kaydı, silme/düzenleme koruma kuralları.
 */
const recipeModule: IModule = {
  id: 'recipe',
  name: 'Recipe Management',
  version: '1.0.0',
  dependencies: ['plc-gateway'],

  async register(app: FastifyInstance, _options: ModuleOptions): Promise<void> {
    await app.register(recipeRoutes, { prefix: '/api/recipes' });
  },
};

export default recipeModule;
