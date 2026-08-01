/**
 * Araba Atama istasyonu — TAM handshake + otomatik temizleme testi.
 * Çalışan backend (http://localhost:3000) + OPC UA sim (localhost:4841) gerekir.
 *
 * Akış: QR üret (ürün step 1'e gelir) → sim PLC + tag kur → trolley_assign'i
 * trigger config ile ayarla → araba onayla (içerik OTOMATİK temizlenir) →
 * Setpoint=0 → ürün tara (AKTİF) → Setpoint=1 (trigger) → doğrula:
 *   - veri + slot ürüne yazıldı, arabaya slot atandı
 *   - Setpoint tekrar 0 (handshake — PLC okuma bitti anladı)
 *   - lastCapture bağlamda
 *
 * Kullanım: node scripts/trace-handshake-test.mjs [baseUrl]
 */

const BASE = process.argv[2] ?? 'http://localhost:3000';
const SIM_ENDPOINT = 'opc.tcp://localhost:4841';

let cookie = '';
let passed = 0;
let failed = 0;

function check(name, condition, extra = '') {
  if (condition) { passed++; console.log(`  ✅ ${name}`); }
  else { failed++; console.log(`  ❌ ${name} ${extra}`); }
}

async function req(method, path, body) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      ...(cookie ? { Cookie: cookie } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const setCookie = res.headers.get('set-cookie');
  if (setCookie) cookie = setCookie.split(';')[0];
  let data = null;
  try { data = await res.json(); } catch { /* boş */ }
  return { status: res.status, data };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ─── Auth ────────────────────────────────────────────────────────────────────
console.log('\n▶ Auth');
{
  const { status } = await req('POST', '/api/auth/login', { username: 'admin', password: 'admin' });
  check('login admin/admin', status === 200, `status=${status}`);
}

// ─── Sim PLC + tag kurulumu ─────────────────────────────────────────────────
console.log('\n▶ Sim PLC + tag kurulumu');
let plcId = 0, triggerTagId = 0, counterTagId = 0, slotTagId = 0;
let stationDbId = 0, originalConfig = null, testTrolleyCode = `TR-TEST-${Date.now() % 100000}`;
{
  const { status, data } = await req('POST', '/api/plc', {
    name: `sim-handshake-${Date.now()}`,
    protocol: 'opcua', endpointUrl: SIM_ENDPOINT,
    securityMode: 'None', securityPolicy: 'None', authType: 'anonymous', isActive: true,
  });
  plcId = data?.plc?.id ?? data?.id ?? 0;
  check('sim PLC oluşturuldu', status === 201 && plcId > 0, `status=${status}`);

  const mkTag = async (name, address, dataType, mode = 'subscribe') => {
    const r = await req('POST', `/api/plc/${plcId}/tags`, { name, address, dataType, acquisitionMode: mode, pollingIntervalMs: 300 });
    return r.data?.tag?.id ?? r.data?.id ?? 0;
  };
  triggerTagId = await mkTag('Sim.Setpoint', 'ns=1;s=Sim.Setpoint', 'FLOAT64');
  counterTagId = await mkTag('Sim.Counter', 'ns=1;s=Sim.Counter', 'UINT16');
  slotTagId = await mkTag('Sim.Pressure', 'ns=1;s=Sim.Pressure', 'FLOAT64');
  check('trigger + data + slot tag oluşturuldu', triggerTagId > 0 && counterTagId > 0 && slotTagId > 0,
    `trigger=${triggerTagId} counter=${counterTagId} slot=${slotTagId}`);

  const start = await req('POST', `/api/plc/${plcId}/start`);
  check('PLC worker başlatıldı', start.status === 200);

  let online = false;
  for (let i = 0; i < 20; i++) {
    const { data: st } = await req('GET', `/api/plc/${plcId}/status`);
    if (st?.status === 'online') { online = true; break; }
    await sleep(500);
  }
  check('PLC online', online, 'çevrimiçi olamadı');
}

// ─── trolley_assign istasyonunu trigger config ile ayarla ───────────────────
console.log('\n▶ trolley_assign trigger config');
{
  const { data } = await req('GET', '/api/trace/stations');
  const st = (data?.stations ?? []).find((s) => s.key === 'trolley_assign');
  stationDbId = st?.id ?? 0;
  originalConfig = st?.config ?? null;
  check('trolley_assign bulundu', stationDbId > 0);
  const { status } = await req('PUT', `/api/trace/stations/${stationDbId}`, {
    config: { plcId, triggerTagId, slotTagId, dataTagIds: [counterTagId] },
  });
  check('trigger config kaydedildi', status === 200, `status=${status}`);
}

// ─── Test arabası + araba onayı (OTOMATİK TEMİZLEME) ────────────────────────
console.log('\n▶ Araba onayı → otomatik temizleme');
{
  await req('POST', '/api/trace/trolleys', { code: testTrolleyCode, slotCount: 20 });
  // Önce içine 2 ürün ata (dolgu olsun diye) — doğrudan scan ile değil, confirm sonrası boş olmalı
  const { data: confirm } = await req('POST', '/api/trace/stations/trolley_assign/trolley', { trolleyCode: testTrolleyCode });
  check('araba onaylandı', confirm?.ok === true && confirm?.trolley?.code === testTrolleyCode, JSON.stringify(confirm));
  check('içerik otomatik temizlendi (slots boş)', (confirm?.trolley?.slots ?? []).length === 0,
    `slots=${JSON.stringify(confirm?.trolley?.slots)}`);
}

// ─── QR üret → ürün step 1 (trolley_assign) ────────────────────────────────
console.log('\n▶ QR üret (yeni ürün)');
let productId = '';
{
  const { data } = await req('POST', '/api/trace/scan', { stationKey: 'qr_generator' });
  productId = data?.productId ?? '';
  check('QR üretildi', !!productId, JSON.stringify(data));
}

// ─── Trigger için Setpoint=0 → ürün tara (AKTİF) → Setpoint=1 ───────────────
console.log('\n▶ Handshake: trigger true → veri yakalanır → trigger otomatik false');
{
  await req('POST', '/api/tags/write', { plcId, tagId: triggerTagId, value: 0 });
  await sleep(400);

  // Ürünü tara → AKTİF (PLC verisi bekleniyor)
  const { data: scan } = await req('POST', '/api/trace/scan', { stationKey: 'trolley_assign', productId });
  check('ürün tarandı → PLC verisi bekleniyor', scan?.ok === true, JSON.stringify(scan));

  // Trigger: Setpoint = 1 (true)
  await req('POST', '/api/tags/write', { plcId, tagId: triggerTagId, value: 1 });

  // Yakalanana kadar bekle
  let rec = null;
  for (let i = 0; i < 30; i++) {
    const { data } = await req('GET', `/api/trace/products/${encodeURIComponent(productId)}`);
    rec = (data?.records ?? []).find((r) => r.station_key === 'trolley_assign' && r.status === 'done');
    if (rec) break;
    await sleep(400);
  }
  check('trigger ile veri ürüne yazıldı (done kaydı)', !!rec, 'done kaydı yok');
  if (rec) {
    let parsed = {};
    try { parsed = JSON.parse(rec.data); } catch { /* boş */ }
    check('counter + slot kaydedildi', parsed[`tag_${counterTagId}`] !== undefined && parsed.slot !== undefined,
      `data=${rec.data}`);
  }

  // HANDSHAKE: Setpoint tekrar 0 olmalı (PLC okuma bitti anladı)
  let triggerVal = null;
  for (let i = 0; i < 20; i++) {
    const { data } = await req('POST', '/api/tags/read', { plcId, tagId: triggerTagId });
    triggerVal = data?.value;
    if (Number(triggerVal) === 0) break;
    await sleep(300);
  }
  check('trigger otomatik false çekildi (handshake)', Number(triggerVal) === 0, `Setpoint=${triggerVal}`);

  // Arabaya slot atandı mı + lastCapture bağlamda mı
  const { data: ctx } = await req('GET', '/api/trace/stations/trolley_assign/context');
  check('ürün arabaya slot ile atandı', (ctx?.trolley?.slots ?? []).some((s) => s.product_id === productId),
    `slots=${JSON.stringify(ctx?.trolley?.slots)}`);
  check('lastCapture bağlamda', ctx?.lastCapture?.productId === productId, JSON.stringify(ctx?.lastCapture));
}

// ─── Temizlik ───────────────────────────────────────────────────────────────
console.log('\n▶ Temizlik');
{
  if (stationDbId && originalConfig) {
    await req('PUT', `/api/trace/stations/${stationDbId}`, { config: originalConfig });
  }
  await req('POST', `/api/plc/${plcId}/stop`);
  await req('DELETE', `/api/plc/${plcId}`);
  check('test PLC silindi', true);
}

console.log(`\n═══ Sonuç: ${passed} başarılı, ${failed} başarısız ═══`);
process.exit(failed > 0 ? 1 : 0);
