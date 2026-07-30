import type { IModule } from './module.interface.js';

/**
 * ModuleRegistry: mevcut tüm modüllerin merkezi kaydı.
 * Modüller build-time'da buraya eklenir (statik import), ModuleLoader
 * çalışma zamanında DB durumuna göre hangilerinin yükleneceğine karar verir.
 */
class ModuleRegistry {
  private modules = new Map<string, IModule>();

  register(module: IModule): void {
    if (this.modules.has(module.id)) {
      throw new Error(`Modül zaten kayıtlı: ${module.id}`);
    }
    this.modules.set(module.id, module);
  }

  get(id: string): IModule | undefined {
    return this.modules.get(id);
  }

  has(id: string): boolean {
    return this.modules.has(id);
  }

  getAll(): IModule[] {
    return Array.from(this.modules.values());
  }

  /**
   * Bağımlılık sırasına göre topolojik sıralama döner.
   * Döngüsel bağımlılık varsa hata fırlatır.
   */
  getSortedByDependencies(): IModule[] {
    const sorted: IModule[] = [];
    const visited = new Set<string>();
    const visiting = new Set<string>();

    const visit = (mod: IModule): void => {
      if (visited.has(mod.id)) return;
      if (visiting.has(mod.id)) {
        throw new Error(`Döngüsel modül bağımlılığı tespit edildi: ${mod.id}`);
      }
      visiting.add(mod.id);
      for (const depId of mod.dependencies ?? []) {
        const dep = this.modules.get(depId);
        if (dep) visit(dep);
      }
      visiting.delete(mod.id);
      visited.add(mod.id);
      sorted.push(mod);
    };

    for (const mod of this.modules.values()) {
      visit(mod);
    }
    return sorted;
  }
}

export const moduleRegistry = new ModuleRegistry();