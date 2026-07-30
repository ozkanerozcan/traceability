import Fastify from 'fastify';
import type { FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import fastifyStatic from '@fastify/static';
import websocket from '@fastify/websocket';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

import authPlugin from './core/auth/auth.plugin.js';
import { authRoutes } from './core/auth/auth.routes.js';
import { wsManager } from './core/websocket/ws.manager.js';
import { getDb } from './core/database/connection.js';
import { runMigrations } from './core/database/migrations.js';
import { initializeDatabase } from './core/database/seed.js';
import { moduleLoader } from './core/module-system/module.loader.js';
import { registerAllModules } from './modules/index.js';

export interface BuildAppOptions {
  /** Üretimde frontend build çıktısının bulunduğu dizin */
  staticRoot?: string;
}

export async function buildApp(options: BuildAppOptions = {}): Promise<FastifyInstance> {
  const app = Fastify({
    logger: {
      level: process.env.LOG_LEVEL ?? 'info',
    },
    trustProxy: true,
  });

  // ─── Veritabanı başlatma ───
  const db = getDb();
  runMigrations(db);
  initializeDatabase(db);

  // ─── Temel plugin'ler ───
  await app.register(cors, {
    origin: true, // air-gapped lokal ağ — tüm origin'lere izin
    credentials: true,
  });

  await app.register(websocket);
  await app.register(authPlugin);

  // ─── Health check (public) ───
  app.get('/api/health', async () => ({
    status: 'ok',
    timestamp: new Date().toISOString(),
    wsClients: wsManager.clientCount,
  }));

  // ─── Auth route'ları ───
  await app.register(authRoutes, { prefix: '/api/auth' });

  // ─── WebSocket endpoint'i ───
  wsManager.register(app);

  // ─── Modül sistemi: modülleri kaydet ve aktif olanları yükle ───
  registerAllModules();
  await moduleLoader.loadAll(app);

  // ─── Frontend statik dosyaları (production) ───
  const staticRoot =
    options.staticRoot ?? resolve(process.cwd(), 'dist', 'public');
  if (existsSync(staticRoot)) {
    await app.register(fastifyStatic, {
      root: staticRoot,
      prefix: '/',
    });

    // SPA fallback: API ve WS dışındaki GET istekleri index.html'e
    app.setNotFoundHandler((request, reply) => {
      if (
        request.method === 'GET' &&
        !request.url.startsWith('/api') &&
        !request.url.startsWith('/ws')
      ) {
        return reply.sendFile('index.html');
      }
      return reply.code(404).send({
        statusCode: 404,
        error: 'Not Found',
        message: 'Kaynak bulunamadı',
      });
    });
  }

  return app;
}