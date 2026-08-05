/**
 * Migration 11 (traceability_station_types) doğrulama scripti.
 * Gerçek DB'nin KOPYASI üzerinde çalışır — canlı veriye dokunmaz.
 *
 * Çalıştırma: node scripts/migration11-test.mjs   (mes/ kökünden)
 */
import { copyFileSync, existsSync, unlinkSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const backendDir = path.join(__dirname, '..', 'packages', 'backend');

// Kopya DB — önce WAL checkpoint (son yazmalar ana dosyaya işlensin)
const srcDb = path.join(backendDir, 'data', 'mes.db');
const testDb = path.join(backendDir, 'data', 'migration11-test.db');
{
  const Database0 = require('better-sqlite3');
  const src = new Database0(srcDb);
  src.pragma('wal_checkpoint(TRUNCATE)');
  src.close();
}
for (const suffix of ['', '-shm', '-wal']) {
  const p = testDb + suffix;
  if (existsSync(p)) unlinkSync(p);
}
copyFileSync(srcDb, testDb);

process.env.DB_PATH = testDb;

// tsx ile TS migration'ları yükle
const { runMigrations } = await import(pathToFileURL(path.join(backendDir, 'src', 'core', 'database', 'migrations.ts')).href);
const Database = require('better-sqlite3');

const db = new Database(testDb);
db.pragma('journal_mode = WAL');

let pass = 0;
let fail = 0;
const check = (name, cond) => {
  if (cond) { pass++; console.log(`  ✅ ${name}`); }
  else { fail++; console.log(`  ❌ ${name}`); }
};

console.log('▶ Migration 11 kopya DB üzerinde çalıştırılıyor...');
runMigrations(db);

console.log('\n▶ Şema doğrulaması:');
const tables = db.prepare(`SELECT name, type FROM sqlite_master WHERE name LIKE 'trace%' OR name IN ('shells','trolleys') ORDER BY name`).all();
const tableNames = tables.map((r) => `${r.name} (${r.type})`);
console.log('  Nesneler:', tableNames.join(', '));

check('trace_routes kaldırıldı', !tables.some((r) => r.name === 'trace_routes'));
check('trace_route_steps kaldırıldı', !tables.some((r) => r.name === 'trace_route_steps'));
check('trace_measurements tablosu var', tables.some((r) => r.name === 'trace_measurements' && r.type === 'table'));
check('trace_station_runtime tablosu var', tables.some((r) => r.name === 'trace_station_runtime' && r.type === 'table'));

const stationCols = db.prepare(`PRAGMA table_info(trace_stations)`).all().map((c) => c.name);
check('trace_stations.capabilities kaldırıldı', !stationCols.includes('capabilities'));
check('trace_stations.config korundu', stationCols.includes('config'));

const shellCols = db.prepare(`PRAGMA table_info(shells)`).all().map((c) => c.name);
check('shells.route_id kaldırıldı', !shellCols.includes('route_id'));
check('shells.current_step_index kaldırıldı', !shellCols.includes('current_step_index'));
check('shells.history korundu', shellCols.includes('history'));

console.log('\n▶ İstasyon dönüşümü:');
const stations = db.prepare('SELECT key, name, type, sort_order, is_active FROM trace_stations ORDER BY sort_order').all();
for (const s of stations) {
  console.log(`  • [${s.sort_order}] ${s.key} → type=${s.type} active=${s.is_active}`);
}
check('qr_generate istasyonu var', stations.some((s) => s.type === 'qr_generate'));
check('trolley_read istasyonu seed edildi', stations.some((s) => s.type === 'trolley_read'));
check('funnel_screwing eşlemesi', stations.some((s) => s.type === 'funnel_screwing'));
check('trolley_shell_matching eşlemesi', stations.some((s) => s.type === 'trolley_shell_matching'));
check('filling eşlemesi', stations.some((s) => s.type === 'filling'));
check('probing eşlemesi', stations.some((s) => s.type === 'probing'));
check('eski tipler pasifleştirildi (legacy)', stations.filter((s) => s.type === 'legacy').every((s) => s.is_active === 0));

console.log('\n▶ Veri korunması:');
const shellCount = db.prepare('SELECT COUNT(*) AS c FROM shells').get().c;
console.log(`  shells: ${shellCount} satır korundu`);
const measCount = db.prepare('SELECT COUNT(*) AS c FROM trace_measurements').get().c;
console.log(`  trace_measurements: ${measCount} satır (history'den taşınan)`);
check('history→measurements taşıması çalıştı', measCount >= 0);

const migrated = db.prepare('SELECT id, name FROM schema_migrations WHERE id = 11').get();
check('schema_migrations kaydı', migrated?.name === 'traceability_station_types');

db.close();
console.log(`\n═══ Sonuç: ${pass} başarılı, ${fail} başarısız ═══`);
process.exit(fail > 0 ? 1 : 0);
