/**
 * PLC Read senaryoları testi — trolley satır-bazlı eşleştirme + clearOnRead.
 * Çalışan backend (http://localhost:3000) + OPC UA sim (localhost:4841) gerekir.
 *
 * Akış: 4 ürün QR üret → trolley_assign'de arabaya yükle (slot 1-4) →
 * "rowtest" istasyonu (trolley_read + plc_acquire satır-bazlı, clearOnRead=FALSE)
 * arabayı oku (İÇERİK TEMİZLENMEZ) → rowTag=0 + trigger → satırdaki 4 ürüne veri.
 *
 * Kullanım: node scripts/trace-scenarios-test.mjs [baseUrl]
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
let plcId = 0, triggerTagId = 0, rowTagId = 0, tempTagId = 0;
{
  const { status, data } = await req('POST', '/api/plc', {
    name: `sim-scenario-${Date.now()}`,
    protocol: 'opcua', endpointUrl: SIM_ENDPOINT,
    securityMode: 'None', securityPolicy: 'None', authType: 'anonymous', isActive: true,
  });
  plcId = data?.plc?.id ?? data?.id ?? 0;
  check('sim PLC oluşturuldu', status === 201 && plcId > 0, `status=${status}`);
  const mkTag = async (name, address, dataType) => {
    const r = await req('POST', `/api/plc/${plcId}/tags`, { name, address, dataType, acquisitionMode: 'subscribe', pollingIntervalMs: 300 });
    return r.data?.tag?.id ?? r.data?.id ?? 0;
  };
  triggerTagId = await mkTag('Sim.Setpoint', 'ns=1;s=Sim.Setpoint', 'FLOAT64');
  rowTagId = await mkTag('Sim.RowNum', 'ns=1;s=Sim.RowNum', 'INT16'); // yazılabilir sabit satır no
  tempTagId = await mkTag('Sim.Temperature', 'ns=1;s=Sim.Temperature', 'FLOAT64');
  check('trigger + row + data tag', triggerTagId > 0 && rowTagId > 0 && tempTagId > 0);
  await req('POST', `/api/plc/${plcId}/start`);
  let online = false;
  for (let i = 0; i < 20; i++) {
    const { data: st } = await req('GET', `/api/plc/${plcId}/status`);
    if (st?.status === 'online') { online = true; break; }
    await sleep(500);
  }
  check('PLC online', online);
}

// ─── rowtest istasyonu (trolley_read + plc_acquire satır-bazlı, clearOnRead=FALSE) ───
console.log('\n▶ rowtest istasyonu (trolley-row, clearOnRead=false)');
let rowtestKey = `rowtest${Date.now() % 10000}`;
{
  const { status, data } = await req('POST', '/api/trace/stations', {
    key: rowtestKey,
    name: 'Row Test',
    type: 'plc',
    capabilities: ['trolley_read', 'plc_acquire'],
    config: {
      clearOnRead: false,
      plcId, triggerTagId,
      shellIdSource: 'trolley', trolleyMatchMode: 'row', rowTagId, rowSize: 4,
      dataTagIds: [tempTagId],
    },
  });
  check('rowtest istasyonu oluşturuldu', status === 201, `status=${status} ${JSON.stringify(data)}`);
}

// ─── 4 ürün üret + arabaya yükle (slot 1-4) ─────────────────────────────────
console.log('\n▶ 4 ürün üret + trolley_assign ile arabaya yükle');
const trolleyCode = `TR-ROW-${Date.now() % 100000}`;
const products = [];
{
  await req('POST', '/api/trace/trolleys', { code: trolleyCode, slotCount: 20 });
  // trolley_assign'de arabayı onayla (auto-clear → boş)
  await req('POST', '/api/trace/stations/trolley_assign/trolley', { trolleyCode });
  for (let i = 0; i < 4; i++) {
    const { data: qr } = await req('POST', '/api/trace/scan', { stationKey: 'qr_generator' });
    products.push(qr?.productId);
    await req('POST', '/api/trace/scan', { stationKey: 'trolley_assign', productId: qr?.productId });
  }
  const { data: ctx } = await req('GET', '/api/trace/stations/trolley_assign/context');
  check('4 ürün arabaya yüklendi (slot 1-4)', (ctx?.trolley?.slots ?? []).length === 4,
    `slots=${JSON.stringify(ctx?.trolley?.slots)}`);
}

// ─── rowtest arabayı oku → clearOnRead=FALSE → içerik TEMİZLENMEZ ──────────
console.log('\n▶ rowtest arabayı oku (clearOnRead=false → temizlenmez)');
{
  const { data: confirm } = await req('POST', `/api/trace/stations/${rowtestKey}/trolley`, { trolleyCode });
  check('rowtest arabayı onayladı', confirm?.ok === true, JSON.stringify(confirm));
  check('içerik TEMİZLENMEDİ (4 ürün hâlâ slotta)', (confirm?.trolley?.slots ?? []).length === 4,
    `slots=${JSON.stringify(confirm?.trolley?.slots)}`);
}

// ─── Trigger: rowTag=0 (slot 1-4) + Setpoint=1 → satırdaki 4 ürüne veri ─────
console.log('\n▶ Trigger: row=0 → satırdaki 4 ürüne veri + handshake');
{
  await req('POST', '/api/tags/write', { plcId, tagId: rowTagId, value: 0 });
  await req('POST', '/api/tags/write', { plcId, tagId: triggerTagId, value: 0 });
  await sleep(400);
  await req('POST', '/api/tags/write', { plcId, tagId: triggerTagId, value: 1 });

  // 4 ürünün hepsinde rowtest 'done' kaydı oluşana kadar bekle
  let doneCount = 0;
  for (let i = 0; i < 30; i++) {
    doneCount = 0;
    for (const pid of products) {
      const { data } = await req('GET', `/api/trace/products/${encodeURIComponent(pid)}`);
      if ((data?.records ?? []).some((r) => r.station_key === rowtestKey && r.status === 'done')) doneCount++;
    }
    if (doneCount === 4) break;
    await sleep(400);
  }
  check('satırdaki 4 ürüne de veri yazıldı', doneCount === 4, `doneCount=${doneCount}`);

  // Veri içeriği (temp) kontrolü — ilk üründe
  const { data: p0 } = await req('GET', `/api/trace/products/${encodeURIComponent(products[0])}`);
  const rec = (p0?.records ?? []).find((r) => r.station_key === rowtestKey && r.status === 'done');
  let parsed = {};
  try { parsed = JSON.parse(rec?.data ?? '{}'); } catch { /* boş */ }
  check('temp değeri ürüne yazıldı', parsed[`tag_${tempTagId}`] !== undefined, `data=${rec?.data}`);

  // Handshake: Setpoint tekrar 0
  let triggerVal = null;
  for (let i = 0; i < 20; i++) {
    const { data } = await req('POST', '/api/tags/read', { plcId, tagId: triggerTagId });
    triggerVal = data?.value;
    if (Number(triggerVal) === 0) break;
    await sleep(300);
  }
  check('trigger otomatik false (handshake)', Number(triggerVal) === 0, `Setpoint=${triggerVal}`);
}

// ─── Temizlik ───────────────────────────────────────────────────────────────
console.log('\n▶ Temizlik');
{
  const { data: st } = await req('GET', '/api/trace/stations');
  const rowtest = (st?.stations ?? []).find((s) => s.key === rowtestKey);
  if (rowtest) await req('DELETE', `/api/trace/stations/${rowtest.id}`);
  await req('POST', `/api/plc/${plcId}/stop`);
  await req('DELETE', `/api/plc/${plcId}`);
  check('temizlik tamam', true);
}

console.log(`\n═══ Sonuç: ${passed} başarılı, ${failed} başarısız ═══`);
process.exit(failed > 0 ? 1 : 0);
