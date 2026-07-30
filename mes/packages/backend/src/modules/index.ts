import { moduleRegistry } from '../core/module-system/module.registry.js';
import plcGatewayModule from './plc-gateway/index.js';
import recipeModule from './recipe/index.js';
import workOrderModule from './work-order/index.js';
import userManagementModule from './user-management/index.js';
import systemSettingsModule from './system-settings/index.js';

/**
 * Tüm uygulama modüllerini registry'ye kaydeder.
 * app.ts içinde buildApp() sırasında, moduleLoader.loadAll()'dan ÖNCE çağrılır.
 */
export function registerAllModules(): void {
  moduleRegistry.register(plcGatewayModule);
  moduleRegistry.register(recipeModule);
  moduleRegistry.register(workOrderModule);
  moduleRegistry.register(userManagementModule);
  moduleRegistry.register(systemSettingsModule);
}
