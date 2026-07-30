/**
 * Faz 3 (Reçete Yönetimi) API doğrulama scripti.
 * Çalışan bir backend'e karşı (varsayılan http://localhost:3100) tüm recipe
 * endpoint'lerini uçtan uca test eder.
 *
 * Kullanım: node scripts/recipe-api-test.mjs [baseUrl]
 */

const BASE = process.argv[2] ?? 'http://localhost:3100';

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
  try {
    data = await res.json();
  } catch {
    // boş gövde
  }
  return { status: res.status, data };
}

// ─── Auth ────────────────────────────────────────────────────────────────────
console.log('\n▶ Auth');
{
  const { status, data } = await req('POST', '/api/auth/login', {
    username: 'admin',
    password: 'admin',
  });
  check('login admin/admin', status === 200, JSON.stringify(data));
}

// ─── Hazırlık: PLC + Tag (eşleştirme testi için) ────────────────────────────
let tagId1, tagId2;
console.log('\n▶ Hazırlık: PLC + tag');
{
  const plcRes = await req('POST', '/api/plc', {
    name: 'Test PLC',
    protocol: 'modbus_tcp',
    host: '127.0.0.1',
    port: 5020,
    isActive: false,
  });
  check('PLC oluştur', plcRes.status === 201, JSON.stringify(plcRes.data));
  const plcId = plcRes.data?.plc?.id;

  const t1 = await req('POST', `/api/plc/${plcId}/tags`, {
    name: 'Temperature',
    address: 40001,
    dataType: 'FLOAT32',
    unit: '°C',
  });
  const t2 = await req('POST', `/api/plc/${plcId}/tags`, {
    name: 'Running',
    address: 1,
    registerType: 'coil',
    dataType: 'BOOL',
  });
  tagId1 = t1.data?.tag?.id;
  tagId2 = t2.data?.tag?.id;
  check('Tag oluştur (x2)', t1.status === 201 && t2.status === 201 && !!tagId1 && !!tagId2);
}

// ─── Recipe CRUD ─────────────────────────────────────────────────────────────
let recipeId;
console.log('\n▶ Recipe CRUD');
{
  const list0 = await req('GET', '/api/recipes');
  check('GET /api/recipes (boş)', list0.status === 200 && list0.data.recipes.length === 0);

  const bad = await req('POST', '/api/recipes', { name: '' });
  check('POST boş isim → 400', bad.status === 400);

  const created = await req('POST', '/api/recipes', {
    name: 'Bisküvi Hattı',
    description: 'Test reçetesi',
  });
  check('POST /api/recipes → 201', created.status === 201, JSON.stringify(created.data));
  recipeId = created.data?.recipe?.id;
  check('id döndü', typeof recipeId === 'number');

  const dup = await req('POST', '/api/recipes', { name: 'Bisküvi Hattı' });
  check('Mükerrer isim → 409', dup.status === 409);

  const detail = await req('GET', `/api/recipes/${recipeId}`);
  check(
    'GET /api/recipes/:id',
    detail.status === 200 &&
      detail.data.recipe.name === 'Bisküvi Hattı' &&
      detail.data.recipe.dashboardLayout === null
  );

  const notFound = await req('GET', '/api/recipes/9999');
  check('GET bilinmeyen → 404', notFound.status === 404);
}

// ─── Reçete güncelleme (ad/açıklama) ─────────────────────────────────────────
console.log('\n▶ Reçete güncelleme');
{
  const upd = await req('PUT', `/api/recipes/${recipeId}`, {
    description: 'Güncellenmiş açıklama',
  });
  check(
    'PUT description → güncellendi',
    upd.status === 200 && upd.data.recipe.description === 'Güncellenmiş açıklama',
    JSON.stringify(upd.data)
  );

  const emptyName = await req('PUT', `/api/recipes/${recipeId}`, { name: '' });
  check('PUT boş isim → 400', emptyName.status === 400);
}

// ─── Dashboard layout ────────────────────────────────────────────────────────
console.log('\n▶ Dashboard layout');
{
  const layout = {
    widgets: [
      {
        id: 'w-1',
        type: 'gauge',
        title: 'Sıcaklık',
        tagId: tagId1,
        options: { min: 0, max: 200, unit: '°C' },
        layout: { x: 0, y: 0, w: 4, h: 4, minW: 3, minH: 3 },
      },
      {
        id: 'w-2',
        type: 'status',
        title: '',
        tagId: tagId2,
        options: {},
        layout: { x: 4, y: 0, w: 3, h: 2 },
      },
    ],
  };
  const save = await req('PUT', `/api/recipes/${recipeId}/dashboard`, { layout });
  check(
    'PUT dashboard → kaydedildi',
    save.status === 200 && save.data.recipe.dashboardLayout.widgets.length === 2,
    JSON.stringify(save.data).slice(0, 300)
  );

  const detail = await req('GET', `/api/recipes/${recipeId}`);
  check(
    'GET sonrası layout geri okunuyor',
    detail.data?.recipe?.dashboardLayout?.widgets?.[0]?.type === 'gauge'
  );

  const badLayout = await req('PUT', `/api/recipes/${recipeId}/dashboard`, {
    layout: { widgets: [{ id: 'x', type: 'hologram', layout: {} }] },
  });
  check('Geçersiz widget tipi → 400', badLayout.status === 400);

  const noWidgets = await req('PUT', `/api/recipes/${recipeId}/dashboard`, {
    layout: { foo: 1 },
  });
  check('widgets olmayan layout → 400', noWidgets.status === 400);
}

// ─── Koruma kuralları ────────────────────────────────────────────────────────
console.log('\n▶ Koruma kuralları');
{
  // İş emri geçmişi olan reçete silinemez — doğrudan DB'ye WO ekleyemediğimiz için
  // API üzerinden work-order modülü henüz yok; burada silme akışını doğruluyoruz.
  const del = await req('DELETE', `/api/recipes/${recipeId}`);
  check('DELETE /api/recipes/:id (WO yok) → 200', del.status === 200);

  const gone = await req('GET', `/api/recipes/${recipeId}`);
  check('Silinen reçete → 404', gone.status === 404);
}

// ─── Sonuç ───────────────────────────────────────────────────────────────────
console.log(`\n═══════════════════════════════════`);
console.log(`Sonuç: ${passed} başarılı, ${failed} başarısız`);
process.exit(failed > 0 ? 1 : 0);
