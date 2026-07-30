# OE MES — Manufacturing Execution System

PLC'lerden veri toplayan, iş emri bazlı üretim takibi yapan, fabrika lokal ağında
air-gapped çalışan modüler MES web uygulaması.

## Teknoloji Yığını

| Katman | Teknoloji |
|--------|-----------|
| Frontend | React 18, Vite, TypeScript, Zustand, react-grid-layout, Recharts, react-i18next, vite-plugin-pwa |
| Backend | Node.js, Fastify, TypeScript, better-sqlite3 (WAL), @fastify/jwt + httpOnly cookie |
| PLC İletişim | modbus-serial (TCP + RTU), node-opcua (OPC UA client + subscription), Node.js Worker Threads |
| Deployment | Docker Compose, tek konteyner, tek port (3000) |

## Proje Yapısı

```
mes/
├── docker-compose.yml      # Tek servislik deployment
├── Dockerfile              # Multi-stage production build
├── .env.example            # Ortam değişkenleri şablonu
├── packages/
│   ├── backend/            # Fastify + SQLite + Modbus
│   │   └── src/
│   │       ├── core/       # database, auth, websocket, module-system, audit
│   │       ├── modules/    # plc-gateway, recipe, work-order, dashboard, ...
│   │       └── shared/     # Ortak tipler ve sabitler
│   └── frontend/           # React + Vite + PWA
│       └── src/
│           ├── core/       # Layout, tema, i18n, store, servisler
│           └── modules/    # Özellik modülleri
└── scripts/
    └── copy-frontend.mjs   # Frontend dist → backend static root
```

## Geliştirme Ortamı Kurulumu

```bash
# 1. Bağımlılıkları kur (npm workspaces — kök dizinden)
npm install

# 2. Ortam değişkenleri
copy .env.example .env       # Windows
# cp .env.example .env       # Linux/macOS

# 3. Backend'i başlat (terminal 1) — http://localhost:3000
npm run dev:backend

# 4. Frontend'i başlat (terminal 2) — http://localhost:5173
npm run dev:frontend
```

Vite dev server, `/api` ve `/ws` isteklerini otomatik olarak
`localhost:3000`'e proxy'ler. Geliştirmede **http://localhost:5173** kullanılır.

### Varsayılan Giriş

| Kullanıcı | Şifre | Rol |
|-----------|-------|-----|
| `admin` | `admin` | Yönetici |

> İlk girişten sonra şifreyi değiştirin.

## Production Build (Docker'sız)

```bash
npm run build   # frontend + backend build + statik kopyalama
npm start       # http://localhost:3000 — API + frontend tek port
```

## Docker ile Deployment

```bash
# .env dosyasında JWT_SECRET tanımlı olmalı
docker compose up -d --build

# Loglar
docker compose logs -f

# Durdurma
docker compose down
```

SQLite verisi `mes-data` volume'ünde, yüklenen dosyalar (logo vb.)
`mes-uploads` volume'ünde saklanır.

## Doğrulama

```bash
# TypeScript tip kontrolü (her iki paket)
npm run typecheck

# Backend testleri
npm test --workspace=packages/backend
```

## OPC UA Frontend Testi

OPC UA haberleşmesini gerçek PLC/SCADA olmadan, tamamen frontend üzerinden
test etmek için lokal simülatör kullanılır:

```bash
node scripts/opcua-sim.mjs   # opc.tcp://127.0.0.1:4840 (SecurityMode=None)
```

Ardından `/plc` sayfasından OPC UA profili oluşturulup "Bağlantıyı Test Et"
ile doğrulanır. Browse ile tag seçimi, subscription canlı veri akışı,
sertifika trust akışı (SignAndEncrypt), kopma/yeniden bağlanma ve
username/password senaryolarının adım adım anlatımı için
`../implementation_plan.md` → **Doğrulama Planı → OPC UA Uçtan Uca
Frontend Test Rehberi** bölümüne bakın.

## Ortam Değişkenleri

| Değişken | Açıklama | Varsayılan |
|----------|----------|------------|
| `JWT_SECRET` | JWT imzalama anahtarı (**zorunlu**) | — |
| `ENCRYPTION_KEY` | OPC UA/PLC kimlik bilgileri için AES-256 anahtarı (64 hex) | `JWT_SECRET`'tan türetilir |
| `PORT` | HTTP/WS portu | `3000` |
| `DB_PATH` | SQLite dosya yolu | `./data/mes.db` |
| `LOG_LEVEL` | Fastify log seviyesi | `info` |

## Modül Sistemi

Backend modülleri `packages/backend/src/modules/` altında yaşar ve `IModule`
arayüzünü implement eder. Modüller admin panelinden açılıp kapatılabilir;
durum `modules` tablosunda tutulur. Detaylar için `implementation_plan.md`.