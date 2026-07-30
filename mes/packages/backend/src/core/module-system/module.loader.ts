import type { FastifyInstance } from 'fastify';
import { getDb } from '../database/connection.js';
import { moduleRegistry } from './module.registry.js';
import type { IModule } from './module.interface.js';
import type { ModuleRow } from '../../shared/types/index.js';

/**
 * ModuleLoader: server başlangıcında registry'deki modülleri tarar,
 * DB'deki enabled durumuna göre aktif modülleri Fastify'a kaydeder.
 *
 * Yaşam döngüsü:
 *  1. loadAll() → enabled modüllerin register() çağrılır (bağımlılık sırasıyla)
 *  2. enableModule() → onEnable() + register() (runtime aktivasyon)
 *  3. disableModule() → onDisable() (route'lar yeniden başlatmadan kaldırılamaz,
 *     bu yüzden disable sonrası restart önerilir)
 *  4. shutdownAll() → tüm aktif modüllerin onShutdown() çağrılır
 */
class ModuleLoader {
  private loadedModules = new Map<string, IModule>();

  /** DB'den modül enabled durumlarını okur. */
  private getModuleStates(): Map<string, { enabled: boolean; config: Record<string, unknown> }> {
    const db = getDb();
    const rows = db.prepare('SELECT * FROM modules').all() as ModuleRow[];
    const states = new Map<string, { enabled: boolean; config: Record<string, unknown> }>();
    for (const row of rows) {
      let config: Record<string, unknown> = {};
      if (row.config) {
        try {
          config = JSON.parse(row.config) as Record<string, unknown>;
        } catch {
          // Bozuk JSON'u yoksay, boş config kullan
        }
      }
      states.set(row.id, { enabled: row.enabled === 1, config });
    }
    return states;
  }

  /** Server başlangıcında tüm aktif modülleri yükler. */
  async loadAll(app: FastifyInstance): Promise<void> {
    const states = this.getModuleStates();
    const sorted = moduleRegistry.getSortedByDependencies();

    for (const mod of sorted) {
      // DB'de kaydı olmayan modüller varsayılan olarak aktif kabul edilir
      const state = states.get(mod.id) ?? { enabled: true, config: {} };

      // Bağımlılıkların yüklü olduğundan emin ol
      const missingDeps = (mod.dependencies ?? []).filter((depId) => {
        const depState = states.get(depId);
        const depEnabled = depState ? depState.enabled : moduleRegistry.has(depId);
        return !depEnabled || !this.loadedModules.has(depId);
      });

      if (!state.enabled) {
        app.log.info(`[modules] Atlandı (devre dışı): ${mod.id}`);
        continue;
      }

      if (missingDeps.length > 0) {
        app.log.warn(
          `[modules] Atlandı (eksik bağımlılık: ${missingDeps.join(', ')}): ${mod.id}`
        );
        continue;
      }

      try {
        await mod.register(app, { config: state.config });
        this.loadedModules.set(mod.id, mod);
        app.log.info(`[modules] Yüklendi: ${mod.id} v${mod.version}`);
      } catch (err) {
        app.log.error(err, `[modules] Yükleme hatası: ${mod.id}`);
      }
    }
  }

  /** Runtime'da bir modülü etkinleştirir. */
  async enableModule(app: FastifyInstance, moduleId: string): Promise<boolean> {
    const mod = moduleRegistry.get(moduleId);
    if (!mod) return false;
    if (this.loadedModules.has(moduleId)) return true;

    const states = this.getModuleStates();
    const state = states.get(moduleId) ?? { enabled: true, config: {} };

    await mod.register(app, { config: state.config });
    await mod.onEnable?.();
    this.loadedModules.set(moduleId, mod);

    const db = getDb();
    db.prepare(
      "UPDATE modules SET enabled = 1, updated_at = datetime('now') WHERE id = ?"
    ).run(moduleId);
    return true;
  }

  /** Runtime'da bir modülü devre dışı bırakır (onDisable çağrılır). */
  async disableModule(moduleId: string): Promise<boolean> {
    const mod = this.loadedModules.get(moduleId);
    const db = getDb();
    db.prepare(
      "UPDATE modules SET enabled = 0, updated_at = datetime('now') WHERE id = ?"
    ).run(moduleId);

    if (!mod) return true;
    await mod.onDisable?.();
    this.loadedModules.delete(moduleId);
    return true;
  }

  /** Kapanışta tüm aktif modüllerin onShutdown() metodunu çağırır. */
  async shutdownAll(): Promise<void> {
    for (const mod of this.loadedModules.values()) {
      try {
        await mod.onShutdown?.();
      } catch (err) {
        console.error(`[modules] Shutdown hatası: ${mod.id}`, err);
      }
    }
    this.loadedModules.clear();
  }

  isLoaded(moduleId: string): boolean {
    return this.loadedModules.has(moduleId);
  }

  getLoadedModules(): IModule[] {
    return Array.from(this.loadedModules.values());
  }
}

export const moduleLoader = new ModuleLoader();