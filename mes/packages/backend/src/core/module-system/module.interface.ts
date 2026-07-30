import type { FastifyInstance } from 'fastify';

export interface ModuleOptions {
  /** Modülün modules tablosundaki JSON config alanı (parse edilmiş) */
  config: Record<string, unknown>;
}

/**
 * Her modül bu arayüzü implement eder.
 * Modüller packages/backend/src/modules/<modül-adı>/index.ts altında tanımlanır.
 */
export interface IModule {
  /** Benzersiz modül kimliği: 'plc-gateway', 'recipe', ... */
  id: string;
  /** Görünen ad: 'PLC Gateway' */
  name: string;
  /** Semver versiyon */
  version: string;
  /** Bağımlı olduğu diğer modül id'leri */
  dependencies?: string[];

  /** Route ve servisleri Fastify'a kaydeder */
  register(app: FastifyInstance, options: ModuleOptions): Promise<void>;
  /** Modül admin panelinden etkinleştirildiğinde çağrılır */
  onEnable?(): Promise<void>;
  /** Modül admin panelinden devre dışı bırakıldığında çağrılır */
  onDisable?(): Promise<void>;
  /** Sunucu kapanırken çağrılır (kaynak temizliği) */
  onShutdown?(): Promise<void>;
}