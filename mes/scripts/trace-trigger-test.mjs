/**
 * PLC Data (plc_acquire) tetikleyici akışı uçtan uca test.
 * Çalışan backend (http://localhost:3000) + OPC UA sim (localhost:4840) gerekir.
 *
 * Akış: sim PLC + tag'ler kur → probing istasyonunu trigger config ile ayarla →
 * ürünü tara (AKTİF olur) → Sim.Bool toggles → watcher veriyi ürüne yazar → doğrula.
 *
 * Kullanım: node scripts/trace-trigger-test.mjs [baseUrl]
 */

const BASE = process.argv[2] ?? 'http://localhost:3000';
const SIM_ENDPOINT = 'opc.tcp://localhost:4841';
const PRODUCT_ID = 'SH-20260730-0001'; // step 3 = probing

let cookie = '';
let passed = 0;
let failed = 0;

function check(name, condition, extra = '') {
  if (condition) {
    passed++;
    console.log(`  ✅ ${name}`);
  } else {
    failed++;
    console.log(`  ❌ ${name} ${extra}`);
  }
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

// ─── Sim PLC kur ─────────────────────────────────────────────────────────────
console.log('\n▶ Sim PLC + tag kurulumu');
let plcId = 0;
let triggerTagId = 0;
let counterTagId = 0;
let tempTagId = 0;
let probingId = 0;
let probingOriginalConfig = null;

{
  const { status, data } = await req('POST', '/api/plc', {
    name: `sim-trigger-${Date.now()}`,
    protocol: 'opcua',
    endpointUrl: SIM_ENDPOINT,
    securityMode: 'None',
    securityPolicy: 'None',
    authType: 'anonymous',
    isActive: true,
  });
  plcId = data?.plc?.id ?? data?.id ?? 0;
  check('sim PLC oluşturuldu', status === 201 && plcId > 0, `status=${status} ${JSON.stringify(data)}`);

  const mkTag = async (name, address, dataType) => {
    const r = await req('POST', `/api/plc/${plcId}/tags`, {
      name, address, dataType, acquisitionMode: 'subscribe', pollingIntervalMs: 500,
    });
    return r.data?.tag?.id ?? r.data?.id ?? 0;
  };
  triggerTagId = await mkTag('Sim.Bool', 'ns=1;s=Sim.Bool', 'BOOL');
  counterTagId = await mkTag('Sim.Counter', 'ns=1;s=Sim.Counter', 'UINT16');
  tempTagId = await mkTag('Sim.Temperature', 'ns=1;s=Sim.Temperature', 'FLOAT64');
  check('trigger + 2 data tag oluşturuldu', triggerTagId > 0 && counterTagId > 0 && tempTagId > 0,
    `trigger=${triggerTagId} counter=${counterTagId} temp=${tempTagId}`);

  const start = await req('POST', `/api/plc/${plcId}/start`);
  check('PLC worker başlatıldı', start.status === 200, `status=${start.status}`);
}

// ─── PLC bağlanana kadar bekle ───────────────────────────────────────────────
console.log('\n▶ PLC bağlantısı bekleniyor');
{
  let online = false;
  for (let i = 0; i < 20; i++) {
    const { data } = await req('GET', `/api/plc/${plcId}/status`);
    if (data?.status === 'online') { online = true; break; }
    await sleep(500);
  }
  check('PLC online', online, 'çevrimiçi olamadı');
}

// ─── Probing istasyonunu trigger config ile ayarla ───────────────────────────
console.log('\n▶ Probing istasyonu trigger config');
{
  const { data } = await req('GET', '/api/trace/stations');
  const probing = (data?.stations ?? []).find((s) => s.key === 'probing');
  probingId = probing?.id ?? 0;
  probingOriginalConfig = probing?.config ?? null;
  check('probing istasyonu bulundu', probingId > 0, JSON.stringify(data?.stations?.map((s) => s.key)));

  const { status } = await req('PUT', `/api/trace/stations/${probingId}`, {
    config: { plcId, triggerTagId, dataTagIds: [counterTagId, tempTagId] },
  });
  check('probing trigger config kaydedildi', status === 200, `status=${status}`);
}

// ─── Ürünü tara (AKTİF olur) ─────────────────────────────────────────────────
console.log('\n▶ Ürün tarama (AKTİF)');
{
  const { status, data } = await req('POST', '/api/trace/scan', { stationKey: 'probing', productId: PRODUCT_ID });
  check('ürün tarandı → PLC verisi bekleniyor', status === 200 && data?.ok === true,
    `status=${status} ${JSON.stringify(data)}`);
}

// ─── Trigger (Sim.Bool toggles) → veri yakalama ─────────────────────────────
console.log('\n▶ Trigger bekleniyor (Sim.Bool toggle) + veri doğrulama');
{
  let captured = null;
  for (let i = 0; i < 30; i++) {
    const { data } = await req('GET', `/api/trace/products/${encodeURIComponent(PRODUCT_ID)}`);
    const rec = (data?.records ?? []).find(
      (r) => r.station_key === 'probing' && r.status === 'done'
    );
    if (rec) { captured = rec; break; }
    await sleep(500);
  }
  check('trigger ile PLC verisi ürüne yazıldı (done kaydı)', !!captured, 'done kaydı bulunamadı');
  if (captured) {
    let parsed = {};
    try { parsed = JSON.parse(captured.data); } catch { /* boş */ }
    const hasCounter = parsed[`tag_${counterTagId}`] !== undefined;
    const hasTemp = parsed[`tag_${tempTagId}`] !== undefined;
    check('data tag değerleri kaydedildi (counter + temp)', hasCounter && hasTemp,
      `data=${captured.data}`);
  }
  const { data: prod } = await req('GET', `/api/trace/products/${encodeURIComponent(PRODUCT_ID)}`);
  check('ürün bir sonraki adıma ilerledi', (prod?.product?.current_step_index ?? 0) >= 4,
    `step=${prod?.product?.current_step_index}`);
}

// ─── Temizlik: probing config geri al + test PLC sil ────────────────────────
console.log('\n▶ Temizlik');
{
  if (probingId && probingOriginalConfig) {
    await req('PUT', `/api/trace/stations/${probingId}`, { config: probingOriginalConfig });
  }
  await req('POST', `/api/plc/${plcId}/stop`);
  const del = await req('DELETE', `/api/plc/${plcId}`);
  check('test PLC silindi', del.status === 200, `status=${del.status}`);
}

console.log(`\n═══ Sonuç: ${passed} başarılı, ${failed} başarısız ═══`);
process.exit(failed > 0 ? 1 : 0);
