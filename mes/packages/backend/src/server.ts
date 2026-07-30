import dotenv from 'dotenv';
import { resolve } from 'node:path';

// .env dosyasını monorepo kök dizininden yükle
dotenv.config({ path: resolve(process.cwd(), '../../.env') });
import { buildApp } from './app.js';
import { closeDb } from './core/database/connection.js';
import { wsManager } from './core/websocket/ws.manager.js';
import { moduleLoader } from './core/module-system/module.loader.js';
import { DEFAULT_PORT } from './shared/constants/index.js';

async function main(): Promise<void> {
  const port = Number(process.env.PORT ?? DEFAULT_PORT);
  const host = process.env.HOST ?? '0.0.0.0';

  const app = await buildApp();

  // ─── Graceful shutdown ───
  const shutdown = async (signal: string): Promise<void> => {
    app.log.info(`[server] ${signal} alındı, kapatılıyor...`);
    try {
      wsManager.closeAll();
      await moduleLoader.shutdownAll();
      await app.close();
      closeDb();
      process.exit(0);
    } catch (err) {
      app.log.error(err, '[server] Kapatma hatası');
      process.exit(1);
    }
  };

  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));

  await app.listen({ port, host });
  app.log.info(`[server] OE MES backend çalışıyor: http://${host}:${port}`);
}

main().catch((err) => {
  console.error('[server] Başlatma hatası:', err);
  process.exit(1);
});