// WebSocket canlı veri testi — PLC 2'ye abone olur, 5 saniye boyunca mesajları yazdırır.
// Kullanım: node scripts/ws-test.mjs <JWT_TOKEN>
import WebSocket from 'ws';

const token = process.argv[2];
if (!token) {
  console.error('Kullanım: node scripts/ws-test.mjs <JWT_TOKEN>');
  process.exit(1);
}

const ws = new WebSocket(`ws://localhost:3000/ws?token=${encodeURIComponent(token)}`);
let messageCount = 0;

ws.on('open', () => {
  console.log('[ws-test] Bağlandı, PLC 2 aboneliği gönderiliyor...');
  ws.send(JSON.stringify({ type: 'subscribe:plc', payload: { plcIds: [2] } }));
});

ws.on('message', (raw) => {
  messageCount++;
  const msg = JSON.parse(raw.toString());
  if (msg.type === 'plc:data') {
    const summary = msg.payload.tags.map((t) => `tag${t.tagId}=${t.value}`).join(', ');
    console.log(`[ws-test] plc:data → ${summary}`);
  } else {
    console.log(`[ws-test] ${msg.type} →`, JSON.stringify(msg.payload));
  }
});

ws.on('close', (code) => {
  console.log(`[ws-test] Kapandı (${code}), toplam ${messageCount} mesaj`);
  process.exit(0);
});

ws.on('error', (err) => {
  console.error('[ws-test] Hata:', err.message);
  process.exit(1);
});

setTimeout(() => ws.close(), 5000);