/**
 * İzlenebilirlik v2 — Uçtan Uca Test (OPC UA sim :4841 + backend :3000)
 *
 * Senaryo:
 *   1. Login + Sim PLC profili + sözleşme tag`leri
 *   2. QR üretimi (manuel trigger) — 4 shell
 *   3. Trolley Okuma (PLC trigger) → runtime DB
 *   4. Funnel Sıkma (PLC trigger) → ölçüm UPSERT
 *   5. Trolley-Shell Eşleştirme (PLC trigger) → shells.trolley_id/slot
 *   6. Dolum (PLC trigger, satır 1) → satırdaki tüm shell`lere ölçüm
 *   7. Problama (PLC trigger) → arabadaki tüm shell`lere ölçüm
 *   8. Hata kontratı: bilinmeyen Shell → ErrorCode=1 + ErrorMsg + Ack=false
 *   9. Manuel trigger (web`den "PLC`den gelmiş gibi")
 *  10. Ölçüm düzenleme / silme / manuel ekleme
 *
 * Çalıştırma: node scripts/trace-e2e-test.mjs   (mes/ kökünden; sim :4841 + backend :3000 açık olmalı)
 */

const BASE = 'http://localhost:3000';
let cookie = '';
let passed = 0;
let failed = 0;

function check(name, cond, extra = '') {
  if (cond) {
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
    /* boş yanıt */
  }
  return { status: res.status, data };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ─── 1) Login ────────────────────────────────────────────────────────────────
console.log('\n▶ 1) Login');
{
  const { status } = await req('POST', '/api/auth/login', { username: 'admin', password: 'admin' });
  check('login admin/admin', status === 200, `status=${status}`);
  if (status !== 200) process.exit(1);
}

// ─── 2) Sim PLC profili + tag'ler ────────────────────────────────────────────
console.log('\n▶ 2) Sim PLC profili (:4841) + sözleşme tag`leri');
let plcId;
{
  const { data: plcs } = await req('GET', '/api/plc');
  const existing = (plcs?.plcs ?? []).find((p) => p.name === 'Sim4841');
  if (existing) {
    plcId = existing.id;
    console.log(`  • Mevcut profil kullanılıyor (id=${plcId})`);
  } else {
    const { status, data } = await req('POST', '/api/plc', {
      name: 'Sim4841',
      protocol: 'opcua',
      endpointUrl: 'opc.tcp://127.0.0.1:4841/UA/OeMesSim',
      securityMode: 'None',
      securityPolicy: 'None',
      authType: 'anonymous',
      isActive: true,
      description: 'E2E test simülatörü',
    });
    check('PLC profili oluşturuldu', status === 201, `status=${status} ${JSON.stringify(data)}`);
    plcId = data?.plc?.id ?? data?.id;
  }

  // Worker'ı başlat + çevrimiçi olana kadar bekle (maks 30 sn)
  await req('POST', `/api/plc/${plcId}/start`);
  let online = false;
  for (let i = 0; i < 30; i++) {
    await sleep(1000);
    const { data: st } = await req('GET', `/api/plc/${plcId}/status`);
    if (st?.status === 'online' || st?.connected === true) {
      online = true;
      break;
    }
  }
  check('PLC worker çevrimiçi', online);
  if (!online) process.exit(1);
}

// Tag'ler — ns=1 (getOwnNamespace)
const tagDefs = [
  ['TrgTrolley', 'ns=1;s=Sim.TrgTrolley', 'BOOL', 'subscribe'],
  ['TrgFunnel', 'ns=1;s=Sim.TrgFunnel', 'BOOL', 'subscribe'],
  ['TrgMatch', 'ns=1;s=Sim.TrgMatch', 'BOOL', 'subscribe'],
  ['TrgFill', 'ns=1;s=Sim.TrgFill', 'BOOL', 'subscribe'],
  ['TrgProbe', 'ns=1;s=Sim.TrgProbe', 'BOOL', 'subscribe'],
  ['ShellId', 'ns=1;s=Sim.ShellId', 'STRING', 'poll'],
  ['TrolleyId', 'ns=1;s=Sim.TrolleyId', 'STRING', 'poll'],
  ['SlotNum', 'ns=1;s=Sim.SlotNum', 'INT16', 'poll'],
  ['RowNum', 'ns=1;s=Sim.RowNum', 'INT16', 'poll'],
  ['Torque', 'ns=1;s=Sim.Temperature', 'FLOAT64', 'poll'],
  ['ShellTemp', 'ns=1;s=Sim.Pressure', 'FLOAT64', 'poll'],
  ['Ack', 'ns=1;s=Sim.Ack', 'BOOL', 'poll'],
  ['ErrorCode', 'ns=1;s=Sim.ErrorCode', 'INT16', 'poll'],
  ['ErrorMsg', 'ns=1;s=Sim.ErrorMsg', 'STRING', 'poll'],
  ['Busy', 'ns=1;s=Sim.Busy', 'BOOL', 'poll'],
];

const tagIds = {};
{
  const { data } = await req('GET', `/api/plc/${plcId}/tags`);
  const existing = data?.tags ?? [];
  for (const [name, address, dataType, mode] of tagDefs) {
    const found = existing.find((t) => t.name === name);
    if (found) {
      tagIds[name] = found.id;
      continue;
    }
    const { status, data: created } = await req('POST', `/api/plc/${plcId}/tags`, {
      name,
      address,
      dataType,
      acquisitionMode: mode,
      pollingIntervalMs: 250,
    });
    if (status !== 201) {
      check(`tag ${name} oluşturuldu`, false, `status=${status} ${JSON.stringify(created)}`);
      continue;
    }
    tagIds[name] = created?.tag?.id ?? created?.id;
  }
  check('15 sözleşme tag\'i hazır', Object.keys(tagIds).length === 15, JSON.stringify(tagIds));
}

// Sim'e değer yazma/okuma yardımcıları
async function simWrite(tagName, value) {
  const { status, data } = await req('POST', '/api/tags/write', { plcId, tagId: tagIds[tagName], value });
  if (status !== 200) console.log(`  ⚠ simWrite ${tagName}=${value} → ${status} ${JSON.stringify(data)}`);
}
async function simRead(tagName) {
  const { data } = await req('POST', '/api/tags/read', { plcId, tagId: tagIds[tagName] });
  return data?.value ?? data?.tag?.value ?? null;
}

// ─── 3) İstasyon konfigürasyonları ───────────────────────────────────────────
console.log('\n▶ 3) İstasyon PLC sözleşmeleri yapılandırılıyor');
const resultTags = {
  ackTagId: tagIds.Ack,
  errorCodeTagId: tagIds.ErrorCode,
  errorMessageTagId: tagIds.ErrorMsg,
  busyTagId: tagIds.Busy,
};
{
  const { data } = await req('GET', '/api/trace/stations');
  const stations = data?.stations ?? [];
  const byKey = Object.fromEntries(stations.map((s) => [s.key, s]));

  const configs = {
    trolley_read: { plcId, trolleyIdTagId: tagIds.TrolleyId, triggerTagId: tagIds.TrgTrolley, clearOnRead: true, ...resultTags },
    funnel_sikma: { plcId, shellIdTagId: tagIds.ShellId, triggerTagId: tagIds.TrgFunnel, dataTagIds: [tagIds.Torque], ...resultTags },
    trolley_assign: { plcId, shellIdTagId: tagIds.ShellId, slotTagId: tagIds.SlotNum, triggerTagId: tagIds.TrgMatch, ...resultTags },
    filling: { plcId, trolleyIdTagId: tagIds.TrolleyId, rowTagId: tagIds.RowNum, triggerTagId: tagIds.TrgFill, dataTagIds: [tagIds.ShellTemp], ...resultTags },
    probing: { plcId, trolleyIdTagId: tagIds.TrolleyId, triggerTagId: tagIds.TrgProbe, dataTagIds: [tagIds.ShellTemp], ...resultTags },
  };

  for (const [key, config] of Object.entries(configs)) {
    const st = byKey[key];
    if (!st) {
      check(`istasyon ${key} mevcut`, false);
      continue;
    }
    const { status } = await req('PUT', `/api/trace/stations/${st.id}`, { config });
    check(`istasyon ${key} config`, status === 200, `status=${status}`);
  }
  // Watcher'ın yeniden yüklenmesi için kısa bekleme
  await sleep(500);
}

// ─── 4) QR üretimi (manuel trigger) ──────────────────────────────────────────
console.log('\n▶ 4) QR Kod Üretim — 4 shell (manuel trigger)');
const shells = ['SH-E2E-1', 'SH-E2E-2', 'SH-E2E-3', 'SH-E2E-4'];
{
  for (const id of shells) {
    const { status, data } = await req('POST', '/api/trace/stations/qr_generator/trigger', { shellId: id });
    // 400 = zaten var (önceki test çalışması) — kabul
    check(`QR üret ${id}`, status === 200 || status === 400, `status=${status} ${data?.message ?? ''}`);
  }
}

// ─── 5) Trolley + Trolley Okuma (PLC trigger) ────────────────────────────────
console.log('\n▶ 5) Trolley Okuma — PLC trigger → runtime DB + Ack + handshake');
{
  await req('POST', '/api/trace/trolleys', { code: 'TR-E2E', slotCount: 20 }); // 409 = zaten var, sorun değil
  await simWrite('TrolleyId', 'TR-E2E');
  await simWrite('TrgTrolley', true);
  await sleep(2500);

  const { data: ctx } = await req('GET', '/api/trace/stations/trolley_read/context');
  check('runtime\'a araba yazıldı (DB)', ctx?.trolley?.code === 'TR-E2E', JSON.stringify(ctx?.trolley));
  const ack = await simRead('Ack');
  check('Ack=true yazıldı', ack === true || ack === 1, `ack=${ack}`);
  const trg = await simRead('TrgTrolley');
  check('handshake: trigger=false çekildi', trg === false || trg === 0, `trg=${trg}`);
  const errCode = await simRead('ErrorCode');
  check('ErrorCode=0', errCode === 0 || errCode === '0', `errCode=${errCode}`);
}

// ─── 6) Funnel Sıkma (PLC trigger) ───────────────────────────────────────────
console.log('\n▶ 6) Funnel Sıkma — ShellId + Torque → ölçüm UPSERT');
{
  await simWrite('ShellId', shells[0]);
  await simWrite('TrgFunnel', true);
  await sleep(2500);

  const { data } = await req('GET', `/api/trace/shells/${shells[0]}/measurements?stationKey=funnel_sikma`);
  const m = (data?.measurements ?? []).find((x) => x.field === 'Torque');
  check('Torque ölçümü yazıldı', m !== undefined && typeof m.value === 'number', JSON.stringify(data?.measurements));
  check('kaynak = plc', m?.source === 'plc', `source=${m?.source}`);
}

// ─── 7) Trolley-Shell Eşleştirme (PLC trigger) ───────────────────────────────
console.log('\n▶ 7) Trolley-Shell Eşleştirme — 4 shell → TR-E2E slot 1-4');
{
  for (let i = 0; i < shells.length; i++) {
    await simWrite('ShellId', shells[i]);
    await simWrite('SlotNum', i + 1);
    await simWrite('TrgMatch', true);
    await sleep(2200);
  }
  const { data: ctx } = await req('GET', '/api/trace/stations/trolley_assign/context');
  check('eşleştirme doğru arabayla (TR-E2E)', ctx?.trolley?.code === 'TR-E2E', JSON.stringify(ctx?.trolley?.code));
  const slots = ctx?.trolley?.slots ?? [];
  check('4 slot doldu', slots.length === 4, JSON.stringify(slots));
  check(
    'slot 1-4 doğru shell\'lerde',
    shells.every((sh, i) => slots.some((s) => s.slot_number === i + 1 && s.product_id === sh)),
    JSON.stringify(slots)
  );
}

// ─── 8) Dolum (PLC trigger, satır 1) ─────────────────────────────────────────
console.log('\n▶ 8) Dolum — TrolleyId + Satır 1 + ShellTemp → satırdaki 4 shell');
{
  await simWrite('TrolleyId', 'TR-E2E');
  await simWrite('RowNum', 1);
  await simWrite('TrgFill', true);
  await sleep(2500);

  let okCount = 0;
  for (const sh of shells) {
    const { data } = await req('GET', `/api/trace/shells/${sh}/measurements?stationKey=filling`);
    if ((data?.measurements ?? []).some((x) => x.field === 'ShellTemp')) okCount++;
  }
  check('satırdaki 4 shell\'e ShellTemp yazıldı', okCount === 4, `okCount=${okCount}`);
}

// ─── 9) Problama (PLC trigger) ───────────────────────────────────────────────
console.log('\n▶ 9) Problama — TrolleyId + ShellTemp → arabadaki TÜM shell\'ler');
{
  await simWrite('TrgProbe', true);
  await sleep(2500);

  let okCount = 0;
  for (const sh of shells) {
    const { data } = await req('GET', `/api/trace/shells/${sh}/measurements?stationKey=probing`);
    if ((data?.measurements ?? []).some((x) => x.field === 'ShellTemp')) okCount++;
  }
  check('tüm shell\'lere problama ölçümü yazıldı', okCount === 4, `okCount=${okCount}`);
}

// ─── 10) Hata kontratı ───────────────────────────────────────────────────────
console.log('\n▶ 10) Hata kontratı — bilinmeyen Shell → ErrorCode=1 + ErrorMsg + Ack=false');
{
  await simWrite('ShellId', 'SH-OLMAYAN');
  await simWrite('TrgFunnel', true);
  await sleep(2500);

  const ack = await simRead('Ack');
  check('Ack=false', ack === false || ack === 0, `ack=${ack}`);
  const errCode = await simRead('ErrorCode');
  check('ErrorCode=1 (SHELL_NOT_FOUND)', Number(errCode) === 1, `errCode=${errCode}`);
  const errMsg = await simRead('ErrorMsg');
  check('ErrorMsg dolu', typeof errMsg === 'string' && errMsg.length > 0, `errMsg=${errMsg}`);
  const trg = await simRead('TrgFunnel');
  check('handshake (hata sonrası da trigger=false)', trg === false || trg === 0, `trg=${trg}`);
}

// ─── 11) Manuel trigger (web`den "PLC`den gelmiş gibi") ─────────────────────
console.log('\n▶ 11) Manuel trigger — web\'den veri girişi (UPSERT)');
{
  const { status, data } = await req('POST', '/api/trace/stations/funnel_sikma/trigger', {
    shellId: shells[1],
    data: { Torque: 99.5 },
  });
  check('manuel trigger 200', status === 200, `status=${status} ${JSON.stringify(data)}`);
  const { data: ms } = await req('GET', `/api/trace/shells/${shells[1]}/measurements?stationKey=funnel_sikma`);
  const m = (ms?.measurements ?? []).find((x) => x.field === 'Torque');
  check('manuel Torque=99.5 yazıldı', Number(m?.value) === 99.5, JSON.stringify(ms?.measurements));
  check('kaynak = manual', m?.source === 'manual', `source=${m?.source}`);
}

// ─── 12) Ölçüm düzenleme / silme / manuel ekleme ────────────────────────────
console.log('\n▶ 12) Ölçüm CRUD — düzenle / manuel ekle / sil');
{
  const { data: ms } = await req('GET', `/api/trace/shells/${shells[1]}/measurements?stationKey=funnel_sikma`);
  const m = (ms?.measurements ?? []).find((x) => x.field === 'Torque');

  const { status: st1, data: upd } = await req('PUT', `/api/trace/measurements/${m.id}`, { value: 88.1 });
  check('ölçüm düzenlendi', st1 === 200 && Number(upd?.measurement?.value) === 88.1, `status=${st1}`);

  const { status: st2 } = await req('POST', '/api/trace/measurements', {
    shellId: shells[2],
    stationKey: 'probing',
    field: 'Manual Note',
    value: 'operatör notu',
  });
  check('manuel ölçüm eklendi', st2 === 201, `status=${st2}`);

  const { status: st3 } = await req('DELETE', `/api/trace/measurements/${m.id}`);
  check('ölçüm silindi', st3 === 200, `status=${st3}`);

  const { data: after } = await req('GET', `/api/trace/shells/${shells[1]}/measurements?stationKey=funnel_sikma`);
  check('silme doğrulandı', !(after?.measurements ?? []).some((x) => x.id === m.id));
}

// ─── Sonuç ───────────────────────────────────────────────────────────────────
console.log(`\n═══ Sonuç: ${passed} başarılı, ${failed} başarısız ═══`);
process.exit(failed > 0 ? 1 : 0);
