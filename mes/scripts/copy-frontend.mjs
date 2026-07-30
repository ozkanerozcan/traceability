// Frontend build çıktısını backend'in static root'una kopyalar.
// Production'da Fastify bu dizini fastify-static ile sunar.
import { cpSync, rmSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const src = resolve(root, 'packages/frontend/dist');
const dest = resolve(root, 'packages/backend/dist/public');

if (!existsSync(src)) {
  console.error('[copy-frontend] Frontend dist bulunamadı:', src);
  process.exit(1);
}

rmSync(dest, { recursive: true, force: true });
cpSync(src, dest, { recursive: true });
console.log(`[copy-frontend] ${src} → ${dest}`);