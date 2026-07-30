/**
 * Geçici doğrulama scripti: plc:status + plc:data olaylarını dinler.
 * Kullanım: node scripts/ws-watch.mjs [plcId]
 * plcId verilirse o PLC'ye subscribe olur (subscribe replay testi dahil).
 */
import WebSocket from 'ws';

const plcId = process.argv[2] ? Number(process.argv[2]) : null;

const loginRes = await fetch('http://localhost:3000/api/auth/login', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ username: 'admin', password: 'admin' }),
});
const { token } = await loginRes.json();
if (!token) {
  console.error('Login başarısız');
  process.exit(1);
}

const ws = new WebSocket(`ws://localhost:3000/ws?token=${encodeURIComponent(token)}`);

ws.on('open', () => {
  console.log(`[${new Date().toISOString()}] WS bağlandı`);
  if (plcId !== null) {
    console.log(`[${new Date().toISOString()}] subscribe:plc → ${plcId} (replay bekleniyor...)`);
    ws.send(JSON.stringify({ type: 'subscribe:plc', payload: { plcIds: [plcId] } }));
  }
});

ws.on('message', (data) => {
  const msg = JSON.parse(data.toString());
  const ts = new Date().toISOString();
  if (msg.type === 'plc:status') {
    console.log(`[${ts}] plc:status →`, JSON.stringify(msg.payload));
  } else if (msg.type === 'plc:data') {
    console.log(`[${ts}] plc:data →`, JSON.stringify(msg.payload));
  }
});

ws.on('close', (code) => console.log(`[${new Date().toISOString()}] WS kapandı (${code})`));
ws.on('error', (err) => console.error('WS hata:', err.message));
