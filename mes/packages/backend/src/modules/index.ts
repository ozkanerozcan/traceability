import { moduleRegistry } from '../core/module-system/module.registry.js';
import plcGatewayModule from './plc-gateway/index.js';
import recipeModule from './recipe/index.js';

/**
 * Tüm uygulama modüllerini registry'ye kaydeder.
 * Yeni modüller (work-order, dashboard, ...) buraya eklenir.
 * app.ts içinde buildApp() sırasında, moduleLoader.loadAll()'dan ÖNCE çağrılır.
 */
export function registerAllModules(): void {
  moduleRegistry.register(plcGatewayModule);
  moduleRegistry.register(recipeModule);
}
