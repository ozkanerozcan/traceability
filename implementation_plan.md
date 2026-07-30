# 🏭 OE MES Web Application — Implementation Plan (v3)

## Amaç

OE için çoklu müşteriye satılabilir, modüler, konfigüre edilebilir bir MES (Manufacturing Execution System) web uygulaması geliştirmek. Sistem PLC'lerden ve OPC UA sunucularından veri toplar, iş emri bazlı üretim takibi yapar ve fabrika lokal ağında air-gapped olarak çalışır.

---

## Teknoloji Kararları

| Karar | Seçim | Gerekçe |
|-------|-------|---------|
| **State Management** | Zustand | Hafif, TypeScript-first, boilerplate yok, React 18+ uyumlu |
| **Drag-Drop Dashboard** | react-grid-layout | Dashboard layout'ları için endüstri standardı, resize + drag desteği |
| **Grafikler** | Recharts | React-native, hafif, responsive, canlı trend desteği |
| **i18n** | react-i18next | Endüstri standardı, lazy loading, namespace desteği |
| **PWA** | vite-plugin-pwa | Workbox tabanlı, otomatik service worker, precache |
| **WebSocket** | Native WebSocket + reconnect | Ekstra bağımlılık yok, air-gapped ortamda sorunsuz |
| **Modbus** | modbus-serial | TCP + RTU desteği, Node.js worker thread uyumlu |
| **OPC UA** | node-opcua | Tam TypeScript/JS OPC UA stack; istemci + subscription (MonitoredItem) desteği; dahili PKI/sertifika yönetimi; native bağımlılık yok → air-gapped kurulumda sorunsuz |
| **Router** | react-router-dom v6 | Standart, nested routes, lazy loading |
| **Icons** | lucide-react | Hafif, tree-shakeable, modern SVG ikonlar |
| **Gauge Widget** | Custom SVG | Bağımlılık eklememek için özel gauge komponenti |
| **Secret Şifreleme** | Node crypto (AES-256-GCM) | OPC UA / PLC kimlik bilgilerinin DB'de şifreli saklanması; ek bağımlılık yok |

---

## Proje Yapısı (Monorepo)

```
mes/
├── docker-compose.yml
├── Dockerfile
├── .env.example
├── .dockerignore
├── README.md
│
├── packages/
│   ├── backend/
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   └── src/
│   │       ├── server.ts                    # Entry point
│   │       ├── app.ts                       # Fastify app builder
│   │       │
│   │       ├── core/                        # 🔒 Çekirdek (her zaman yüklü)
│   │       │   ├── database/
│   │       │   │   ├── connection.ts        # SQLite bağlantı + WAL + pragmalar
│   │       │   │   ├── migrations.ts        # Versiyonlu şema migration'ları (schema_migrations)
│   │       │   │   └── seed.ts              # Varsayılan admin kullanıcı + varsayılan ayarlar
│   │       │   ├── auth/
│   │       │   │   ├── auth.plugin.ts       # Fastify plugin (JWT doğrulama)
│   │       │   │   ├── auth.routes.ts       # Login/logout/me/change-password
│   │       │   │   └── auth.service.ts      # bcrypt + JWT işlemleri
│   │       │   ├── crypto/
│   │       │   │   └── secret.service.ts    # AES-256-GCM ile kimlik bilgisi şifreleme/çözme
│   │       │   ├── websocket/
│   │       │   │   ├── ws.manager.ts        # WebSocket sunucu + oda yönetimi + heartbeat
│   │       │   │   └── ws.types.ts          # Mesaj tipleri
│   │       │   ├── module-system/
│   │       │   │   ├── module.registry.ts   # Modül kayıt sistemi
│   │       │   │   ├── module.loader.ts     # Dinamik modül yükleyici
│   │       │   │   └── module.interface.ts  # IModule arayüzü
│   │       │   └── audit/
│   │       │       └── audit.service.ts     # Audit trail kaydı
│   │       │
│   │       ├── modules/                     # 🧩 Takılıp çıkan modüller
│   │       │   ├── plc-gateway/
│   │       │   │   ├── index.ts             # Modül tanımı + register
│   │       │   │   ├── plc.routes.ts        # PLC CRUD + start/stop/test/status
│   │       │   │   ├── plc.service.ts
│   │       │   │   ├── tag.routes.ts
│   │       │   │   ├── tag.service.ts
│   │       │   │   ├── opcua.routes.ts      # Browse + sertifika güven yönetimi endpoint'leri
│   │       │   │   ├── workers/
│   │       │   │   │   ├── plc.worker.ts    # Worker thread ana dosyası
│   │       │   │   │   └── worker.manager.ts # Worker yaşam döngüsü yönetimi
│   │       │   │   └── adapters/
│   │       │   │       ├── adapter.interface.ts     # IProtocolAdapter (protokolden bağımsız)
│   │       │   │       ├── modbus-tcp.adapter.ts
│   │       │   │       ├── modbus-rtu.adapter.ts
│   │       │   │       ├── opcua.adapter.ts         # ✅ OPC UA istemci adaptörü (node-opcua)
│   │       │   │       ├── opcua-browser.service.ts # OPC UA adres alanı (NodeId) gezinme
│   │       │   │       └── certificate.manager.ts   # PKI + sunucu sertifikası güven yönetimi
│   │       │   │
│   │       │   ├── recipe/
│   │       │   │   ├── index.ts
│   │       │   │   ├── recipe.routes.ts
│   │       │   │   └── recipe.service.ts
│   │       │   │
│   │       │   ├── work-order/
│   │       │   │   ├── index.ts
│   │       │   │   ├── work-order.routes.ts
│   │       │   │   ├── work-order.service.ts
│   │       │   │   └── data-collector.service.ts  # Aktif WO için veri kaydetme
│   │       │   │
│   │       │   ├── dashboard/
│   │       │   │   ├── index.ts
│   │       │   │   ├── dashboard.routes.ts
│   │       │   │   └── dashboard.service.ts
│   │       │   │
│   │       │   ├── user-management/
│   │       │   │   ├── index.ts
│   │       │   │   ├── user.routes.ts
│   │       │   │   └── user.service.ts
│   │       │   │
│   │       │   └── system-settings/
│   │       │       ├── index.ts
│   │       │       ├── settings.routes.ts
│   │       │       ├── settings.service.ts
│   │       │       └── archive.service.ts   # DB arşivleme
│   │       │
│   │       └── shared/
│   │           ├── types/                   # Ortak TypeScript tipleri
│   │           ├── utils/                   # Yardımcı fonksiyonlar
│   │           └── constants/               # Sabitler (hata kodları, protokol sabitleri)
│   │
│   └── frontend/
│       ├── package.json
│       ├── vite.config.ts
│       ├── tsconfig.json
│       ├── index.html
│       ├── public/
│       │   ├── manifest.json               # PWA manifest
│       │   └── icons/                      # PWA ikonları
│       └── src/
│           ├── main.tsx                     # React entry point
│           ├── App.tsx                      # Router + providers
│           │
│           ├── core/
│           │   ├── components/
│           │   │   ├── Layout/             # Sidebar + Header + Content
│           │   │   ├── ThemeProvider/       # Dark/Light tema yönetimi
│           │   │   ├── LanguageProvider/    # TR/EN dil yönetimi
│           │   │   ├── ProtectedRoute/     # Yetki kontrolü
│           │   │   ├── ErrorBoundary/      # Hata sınırı + toast bildirim altyapısı
│           │   │   └── common/             # Button, Input, Modal, Table, Card...
│           │   ├── hooks/
│           │   │   ├── useAuth.ts
│           │   │   ├── useWebSocket.ts
│           │   │   ├── useTheme.ts
│           │   │   └── useLanguage.ts
│           │   ├── services/
│           │   │   ├── api.ts              # Fetch wrapper + standart hata zarfı çözümleme
│           │   │   └── ws.ts               # WebSocket client + reconnect (exponential backoff)
│           │   ├── store/
│           │   │   ├── authStore.ts         # Zustand auth state
│           │   │   └── appStore.ts          # Zustand global app state
│           │   ├── i18n/
│           │   │   ├── index.ts
│           │   │   ├── locales/
│           │   │   │   ├── tr.json
│           │   │   │   └── en.json
│           │   └── styles/
│           │       ├── index.css            # Global styles + reset
│           │       ├── variables.css        # CSS custom properties (renkler, spacing)
│           │       └── themes/
│           │           ├── dark.css
│           │           └── light.css
│           │
│           ├── modules/
│           │   ├── plc-gateway/
│           │   │   ├── components/
│           │   │   │   ├── PlcList.tsx          # PLC profil listesi
│           │   │   │   ├── PlcForm.tsx          # PLC ekleme/düzenleme (protokole göre dinamik alanlar)
│           │   │   │   ├── OpcUaConfigPanel.tsx # OPC UA: endpoint, güvenlik modu/politikası, kimlik doğrulama
│           │   │   │   ├── TagList.tsx          # Tag listesi
│           │   │   │   ├── TagForm.tsx          # Tag ekleme/düzenleme (protokole göre adres alanı)
│           │   │   │   ├── NodeBrowserDialog.tsx# ✅ OPC UA sunucu adres alanı gezinme + node seçimi
│           │   │   │   ├── CertificateTrustPanel.tsx # ✅ Reddedilen/bekleyen sunucu sertifikalarını onaylama
│           │   │   │   ├── LiveMonitor.tsx      # Aktif WO olmadan canlı izleme ekranı
│           │   │   │   └── ReadWritePanel.tsx   # Manuel okuma/yazma
│           │   │   ├── hooks/
│           │   │   ├── services/
│           │   │   └── index.tsx            # Modül sayfası + routing
│           │   │
│           │   ├── recipe/
│           │   │   ├── components/
│           │   │   │   ├── RecipeList.tsx
│           │   │   │   ├── RecipeForm.tsx
│           │   │   │   ├── TagMapper.tsx      # PLC tag seçimi
│           │   │   │   └── DashboardEditor.tsx # Sürükle-bırak layout düzenleyici
│           │   │   └── ...
│           │   │
│           │   ├── work-order/
│           │   │   ├── components/
│           │   │   │   ├── WorkOrderList.tsx
│           │   │   │   ├── WorkOrderForm.tsx
│           │   │   │   ├── WorkOrderDetail.tsx
│           │   │   │   └── StatusBadge.tsx
│           │   │   └── ...
│           │   │
│           │   ├── dashboard/
│           │   │   ├── components/
│           │   │   │   ├── DashboardView.tsx      # Aktif WO dashboard
│           │   │   │   ├── DashboardSelector.tsx   # WO seçimi
│           │   │   │   └── widgets/
│           │   │   │       ├── NumericWidget.tsx    # Büyük sayısal gösterge
│           │   │   │       ├── GaugeWidget.tsx      # İbreli gösterge
│           │   │   │       ├── TrendChartWidget.tsx  # Canlı çizgi grafik
│           │   │   │       ├── StatusWidget.tsx      # Yeşil/Kırmızı durum
│           │   │   │       └── TableWidget.tsx       # Çoklu değer tablosu
│           │   │   └── ...
│           │   │
│           │   ├── user-management/
│           │   │   ├── components/
│           │   │   │   ├── UserList.tsx
│           │   │   │   ├── UserForm.tsx
│           │   │   │   └── PermissionEditor.tsx   # Operator yetki konfigürasyonu
│           │   │   └── ...
│           │   │
│           │   └── system-settings/
│           │       ├── components/
│           │       │   ├── GeneralSettings.tsx
│           │       │   ├── ModuleManager.tsx       # Modül açma/kapama
│           │       │   ├── BrandingSettings.tsx    # Logo + firma adı
│           │       │   ├── ArchivePanel.tsx        # DB arşivleme
│           │       │   └── AuditLogViewer.tsx      # Audit trail
│           │       └── ...
│           │
│           └── shared/
│               ├── components/               # Paylaşılan UI bileşenleri
│               └── utils/                    # Paylaşılan yardımcı fonksiyonlar
│
├── scripts/
│   ├── copy-frontend.mjs                   # Frontend dist → backend static root
│   ├── modbus-sim.mjs                      # Modbus TCP test simülatörü
│   ├── opcua-sim.mjs                       # ✅ OPC UA test sunucu simülatörü (node-opcua)
│   └── ws-test.mjs                         # WebSocket bağlantı/veri akışı testi
```

---

## Veritabanı Şeması (SQLite)

### Migration Stratejisi

- `schema_migrations` tablosu: `(version INTEGER PRIMARY KEY, applied_at TEXT)`.
- `migrations.ts` içinde sıralı, immutable migration dizisi tutulur; sunucu başlangıcında mevcut versiyondan itibaren eksik olanlar uygulanır.
- Şema değişiklikleri **asla eski migration'ı değiştirmez**; yeni migration (örn. `ALTER TABLE plc_profiles ADD COLUMN endpoint_url TEXT`) olarak eklenir.
- Migration çalışmadan önce otomatik dosya yedeği alınır: `mes.db.bak-<timestamp>`.

### Core Tabloları

```sql
-- Migration versiyon takibi
CREATE TABLE schema_migrations (
    version     INTEGER PRIMARY KEY,
    applied_at  TEXT DEFAULT (datetime('now'))
);

-- Kullanıcılar
CREATE TABLE users (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    username        TEXT UNIQUE NOT NULL,
    password_hash   TEXT NOT NULL,
    role            TEXT NOT NULL CHECK(role IN ('admin', 'supervisor', 'operator')),
    display_name    TEXT,
    language        TEXT DEFAULT 'tr',
    theme           TEXT DEFAULT 'dark',
    is_active       INTEGER DEFAULT 1,
    must_change_password INTEGER DEFAULT 1,   -- İlk girişte şifre değiştirme zorunluluğu
    created_at      TEXT DEFAULT (datetime('now')),
    updated_at      TEXT DEFAULT (datetime('now'))
);

-- Sistem Ayarları (key-value)
CREATE TABLE system_settings (
    key         TEXT PRIMARY KEY,
    value       TEXT NOT NULL,
    category    TEXT NOT NULL,     -- 'general', 'branding', 'security'
    updated_at  TEXT DEFAULT (datetime('now'))
);

-- Varsayılan ayarlar (seed):
--   session.timeout_minutes        = 480      (security)
--   password.min_length            = 8        (security)
--   archive.db_size_warn_mb        = 2048     (general)
--   ws.heartbeat_interval_ms       = 30000    (general)
--   branding.company_name          = 'OE'     (branding)
--   branding.logo_path             = ''       (branding)

-- Modül Durumları
CREATE TABLE modules (
    id          TEXT PRIMARY KEY,  -- 'plc-gateway', 'recipe', 'work-order', ...
    name        TEXT NOT NULL,
    enabled     INTEGER DEFAULT 1,
    config      TEXT,              -- JSON konfigürasyon
    updated_at  TEXT DEFAULT (datetime('now'))
);

-- Audit Trail
CREATE TABLE audit_log (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id     INTEGER REFERENCES users(id),
    username    TEXT,
    action      TEXT NOT NULL,     -- 'create', 'update', 'delete', 'login', 'start', 'stop', 'trust_cert'
    entity_type TEXT,              -- 'work_order', 'recipe', 'plc', 'user', 'settings', 'opcua_cert'
    entity_id   TEXT,
    details     TEXT,              -- JSON detay
    ip_address  TEXT,
    created_at  TEXT DEFAULT (datetime('now'))
);

-- Operator Rol Yetkileri (Admin tarafından konfigüre edilir)
CREATE TABLE role_permissions (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    role        TEXT NOT NULL,     -- 'operator'
    module_id   TEXT NOT NULL,
    permission  TEXT NOT NULL,     -- 'view', 'create', 'edit', 'delete', 'manage'
    granted     INTEGER DEFAULT 0,
    UNIQUE(role, module_id, permission)
);
```

### PLC Gateway Tabloları

```sql
-- PLC / OPC UA Sunucu Profilleri
CREATE TABLE plc_profiles (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    name            TEXT UNIQUE NOT NULL,
    protocol        TEXT NOT NULL CHECK(protocol IN ('modbus_tcp', 'modbus_rtu', 'opcua')),

    -- ─── Modbus TCP ayarları ───
    host            TEXT,
    port            INTEGER DEFAULT 502,
    unit_id         INTEGER DEFAULT 1,

    -- ─── Modbus RTU ayarları ───
    serial_port     TEXT,
    baud_rate       INTEGER DEFAULT 9600,
    data_bits       INTEGER DEFAULT 8,
    stop_bits       INTEGER DEFAULT 1,
    parity          TEXT DEFAULT 'none',

    -- ─── OPC UA ayarları ───
    endpoint_url        TEXT,                    -- opc.tcp://192.168.1.100:4840
    security_mode       TEXT DEFAULT 'None'
                        CHECK(security_mode IN ('None', 'Sign', 'SignAndEncrypt')),
    security_policy     TEXT DEFAULT 'None'
                        CHECK(security_policy IN ('None', 'Basic128Rsa15', 'Basic256',
                              'Basic256Sha256', 'Aes128_Sha256_RsaOaep', 'Aes256_Sha256_RsaPss')),
    auth_type           TEXT DEFAULT 'anonymous'
                        CHECK(auth_type IN ('anonymous', 'username', 'certificate')),
    auth_username       TEXT,
    auth_password_enc   TEXT,                    -- AES-256-GCM ile şifrelenmiş (asla düz metin değil)
    session_timeout_ms  INTEGER DEFAULT 30000,

    -- ─── Genel ───
    description     TEXT,
    is_active       INTEGER DEFAULT 1,
    created_at      TEXT DEFAULT (datetime('now')),
    updated_at      TEXT DEFAULT (datetime('now'))
);

-- Tag Tanımları (Modbus register + OPC UA NodeId)
CREATE TABLE plc_tags (
    id                  INTEGER PRIMARY KEY AUTOINCREMENT,
    plc_id              INTEGER NOT NULL REFERENCES plc_profiles(id) ON DELETE CASCADE,
    name                TEXT NOT NULL,

    -- Adres protokole göre yorumlanır:
    --   Modbus : '40001'  (mutlak register numarası; adaptör offset çıkarır)
    --   OPC UA : 'ns=2;s=Kanal.Cihaz.Tag'  veya  'ns=2;i=10846'  (NodeId)
    address             TEXT NOT NULL,

    register_type       TEXT DEFAULT 'holding'
                        CHECK(register_type IN ('holding', 'input', 'coil', 'discrete')),
                        -- OPC UA'da kullanılmaz (yok sayılır)

    data_type           TEXT NOT NULL
                        CHECK(data_type IN ('BOOL','INT16','UINT16','INT32','UINT32',
                                            'INT64','UINT64','FLOAT32','FLOAT64','STRING')),
                        -- INT64/UINT64/STRING öncelikle OPC UA içindir

    acquisition_mode    TEXT DEFAULT 'poll'
                        CHECK(acquisition_mode IN ('poll', 'subscribe')),
                        -- 'subscribe' yalnız OPC UA'da geçerlidir; Modbus her zaman 'poll'

    polling_interval_ms INTEGER NOT NULL DEFAULT 1000,
                        -- poll: okuma periyodu | subscribe: publishing interval (sunucu kısıtına clamp edilir)

    unit                TEXT,                       -- °C, bar, adet, rpm...
    description         TEXT,
    word_swap           INTEGER DEFAULT 0,          -- Modbus FLOAT32/32-bit word swap
    byte_swap           INTEGER DEFAULT 0,          -- Modbus byte swap

    -- Ölçekleme (mühendislik birimi dönüşümü):  gösterilen_değer = ham_değer * scale_factor + value_offset
    scale_factor        REAL DEFAULT 1.0,
    value_offset        REAL DEFAULT 0.0,

    deadband            REAL DEFAULT 0,             -- OPC UA subscription absolute deadband filtresi (0 = kapalı)

    is_active           INTEGER DEFAULT 1,
    created_at          TEXT DEFAULT (datetime('now')),
    updated_at          TEXT DEFAULT (datetime('now')),
    UNIQUE(plc_id, name)
);

-- OPC UA Sunucu Sertifikası Güven Yönetimi
CREATE TABLE opcua_trusted_certs (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    plc_id          INTEGER NOT NULL REFERENCES plc_profiles(id) ON DELETE CASCADE,
    thumbprint      TEXT NOT NULL,           -- SHA-1 thumbprint
    subject         TEXT,                    -- Sertifika subject CN bilgisi
    pem             TEXT NOT NULL,           -- PEM formatında sertifika
    status          TEXT NOT NULL DEFAULT 'pending'
                    CHECK(status IN ('pending', 'trusted', 'rejected')),
    first_seen_at   TEXT DEFAULT (datetime('now')),
    decided_at      TEXT,
    decided_by      INTEGER REFERENCES users(id),
    UNIQUE(plc_id, thumbprint)
);
```

### Reçete Tabloları

```sql
-- Reçeteler
CREATE TABLE recipes (
    id                INTEGER PRIMARY KEY AUTOINCREMENT,
    name              TEXT UNIQUE NOT NULL,
    description       TEXT,
    dashboard_layout  TEXT,        -- JSON: react-grid-layout konfigürasyonu
    created_at        TEXT DEFAULT (datetime('now')),
    updated_at        TEXT DEFAULT (datetime('now'))
);

-- Reçete ↔ Tag Eşleştirmesi
CREATE TABLE recipe_tags (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    recipe_id   INTEGER NOT NULL REFERENCES recipes(id) ON DELETE CASCADE,
    tag_id      INTEGER NOT NULL REFERENCES plc_tags(id),
    display_name TEXT,             -- Dashboard'da gösterilecek isim (opsiyonel override)
    widget_type  TEXT DEFAULT 'numeric',  -- Widget tipi önerisi
    sort_order   INTEGER DEFAULT 0,
    created_at   TEXT DEFAULT (datetime('now')),
    UNIQUE(recipe_id, tag_id)
);
```

### İş Emri ve Veri Tabloları

```sql
-- İş Emirleri
CREATE TABLE work_orders (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    order_number    TEXT UNIQUE NOT NULL,    -- WO-20260715-001
    recipe_id       INTEGER NOT NULL REFERENCES recipes(id),
    status          TEXT NOT NULL DEFAULT 'draft'
                    CHECK(status IN ('draft', 'active', 'paused', 'completed', 'archived')),
    started_at      TEXT,
    paused_at       TEXT,
    completed_at    TEXT,
    created_by      INTEGER REFERENCES users(id),
    started_by      INTEGER REFERENCES users(id),
    completed_by    INTEGER REFERENCES users(id),
    notes           TEXT,
    created_at      TEXT DEFAULT (datetime('now')),
    updated_at      TEXT DEFAULT (datetime('now'))
);

-- Veri Kaydı (Zaman Serisi)
CREATE TABLE data_log (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    timestamp       TEXT NOT NULL,
    work_order_id   INTEGER NOT NULL,
    tag_id          INTEGER NOT NULL,
    value           REAL,
    value_text      TEXT,                   -- STRING tipli tag'ler için (OPC UA)
    quality         TEXT DEFAULT 'good'     -- OPC UA veri kalitesi: good / uncertain / bad
);

-- Performans İndeksleri
CREATE INDEX idx_data_log_ts ON data_log(timestamp);
CREATE INDEX idx_data_log_wo ON data_log(work_order_id);
CREATE INDEX idx_data_log_wo_tag_ts ON data_log(work_order_id, tag_id, timestamp);
```

---

## Backend Modül Sistemi

### IModule Arayüzü

```typescript
// Her modül bu arayüzü implement eder
interface IModule {
    id: string;                     // 'plc-gateway', 'recipe', ...
    name: string;                   // 'PLC Gateway'
    version: string;                // '1.0.0'
    dependencies?: string[];        // Bağımlı olduğu modüller

    register(app: FastifyInstance, options: ModuleOptions): Promise<void>;
    onEnable?(): Promise<void>;
    onDisable?(): Promise<void>;
    onShutdown?(): Promise<void>;
}
```

### Modül Yaşam Döngüsü

```
1. Server başlar → ModuleLoader tüm modülleri tarar
2. DB'den modül durumlarını (enabled/disabled) okur
3. Aktif modüllerin register() fonksiyonunu çağırır
4. Her modül kendi route'larını ve servislerini kaydeder
5. Admin panelinden modül kapatıldığında → onDisable() çağrılır
6. Admin panelinden modül açıldığında → onEnable() çağrılır
7. Server kapanırken → onShutdown() tüm modüller için çağrılır
```

---

## PLC Gateway Mimarisi

### Worker Thread Akışı

```
Ana Thread (Fastify)
  │
  ├── WorkerManager
  │     ├── Worker_PLC1 (Thread) ──→ ModbusTcpAdapter ──→ PLC_1 (192.168.1.100:502)
  │     ├── Worker_PLC2 (Thread) ──→ ModbusRtuAdapter ──→ PLC_2 (COM3 / /dev/ttyUSB0)
  │     └── Worker_PLC3 (Thread) ──→ OpcUaAdapter ─────→ OPC UA Sunucu (opc.tcp://192.168.1.110:4840)
  │
  │   MessagePort (her worker ile çift yönlü)
  │     ├── Ana → Worker: { cmd: 'start' | 'stop' | 'read' | 'write' | 'updateConfig' | 'browse' }
  │     └── Worker → Ana: { event: 'data' | 'status' | 'error' | 'cert_pending', payload: {...} }
  │
  ├── WebSocket Manager
  │     └── Canlı veriyi frontend'e broadcast eder
  │
  └── DataCollector Service
        └── Aktif iş emirleri için verileri SQLite'a yazar (transaction batching)
```

### Protocol Adapter Pattern (Protokolden Bağımsız)

```typescript
// Adres protokole göre yorumlanır: Modbus '40001' | OPC UA 'ns=2;s=...' / 'ns=2;i=...'
type TagAddress = string;

type TagDataType = 'BOOL' | 'INT16' | 'UINT16' | 'INT32' | 'UINT32'
                 | 'INT64' | 'UINT64' | 'FLOAT32' | 'FLOAT64' | 'STRING';

interface TagReadResult {
    value: number | string | boolean | null;
    quality: 'good' | 'uncertain' | 'bad';   // Modbus'ta her zaman 'good' (okuma başarılıysa)
    timestamp: string;
}

interface SubscribedTag {
    tagId: number;
    address: TagAddress;
    dataType: TagDataType;
    publishingIntervalMs: number;
    deadband?: number;                       // Absolute deadband (0 = filtre yok)
}

interface BrowseNode {
    nodeId: string;
    displayName: string;
    nodeClass: 'Object' | 'Variable' | 'ObjectType' | 'VariableType' | 'Method' | 'ReferenceType';
    dataType?: TagDataType;                  // Variable ise eşlenen veri tipi
    hasChildren: boolean;
}

interface IProtocolAdapter {
    connect(config: ConnectionConfig): Promise<void>;
    disconnect(): Promise<void>;
    isConnected(): boolean;

    readValue(address: TagAddress, dataType: TagDataType): Promise<TagReadResult>;
    writeValue(address: TagAddress, value: number | string | boolean, dataType: TagDataType): Promise<void>;
    testConnection(): Promise<boolean>;

    // ─── Opsiyonel yetenekler (protokol destekliyorsa implement edilir) ───
    supportsSubscription(): boolean;                     // Modbus: false | OPC UA: true
    subscribe?(tags: SubscribedTag[],
               onData: (r: TagReadResult & { tagId: number }) => void): Promise<void>;
    browse?(nodeId?: string): Promise<BrowseNode[]>;     // OPC UA adres alanı gezinme
}

// ModbusTcpAdapter  implements IProtocolAdapter  (supportsSubscription → false)
// ModbusRtuAdapter  implements IProtocolAdapter  (supportsSubscription → false)
// OpcUaAdapter      implements IProtocolAdapter  (supportsSubscription → true, browse → true)
```

> [!NOTE]
> **Modbus Adresleme:** Kullanıcı arayüzde PLC adresini `40001`, `40002` vb. mutlak (absolute) formatta girecektir. Adaptörler arka planda otomatik olarak `40000` çıkartıp (offset) doğru register okuma komutunu (örn: `0x03 Read Holding Registers` offset 0) gönderecektir.

> [!NOTE]
> **OPC UA Adresleme (NodeId):** Kullanıcı NodeId'yi `ns=2;s=Channel1.Device1.Tag1` (string), `ns=2;i=10846` (numeric) veya `ns=1;g=...` (GUID) formatında girebilir. Elle girmek yerine **NodeBrowserDialog** ile sunucu adres alanı gezilip seçim yapılabilir; seçimde veri tipi de otomatik dolar.

### Veri Toplama Modu Karşılaştırması

| Protokol | Varsayılan Mod | Mekanizma |
|----------|---------------|-----------|
| Modbus TCP/RTU | `poll` | setInterval grupları, polling periyotlarına göre batch register okuma |
| OPC UA | `subscribe` | Tek Subscription + tag başına MonitoredItem; publishing interval = tag `polling_interval_ms` (sunucu min/max kısıtına clamp edilir); `deadband` filtresi desteklenir |
| OPC UA | `poll` (fallback) | Sunucu subscription desteklemiyorsa / tag `acquisition_mode='poll'` ise setInterval gruplarıyla batch `ReadRequest` |

### Worker İçi Polling Mekanizması (Modbus + OPC UA poll modu)

```
Worker başlar → Cihaza bağlanır
  │
  ├── Tag'ler polling periyoduna göre gruplandırılır
  │     ├── Grup_1sn: [Tag_A, Tag_C, Tag_E]     → Her 1 saniyede oku
  │     ├── Grup_2sn: [Tag_B]                    → Her 2 saniyede oku
  │     └── Grup_5sn: [Tag_D, Tag_F]             → Her 5 saniyede oku
  │
  ├── Her grup kendi setInterval zamanlayıcısına sahip
  │
  ├── Okunan değerler → MessagePort ile Ana Thread'e gönderilir
  │
  └── Bağlantı koparsa → Otomatik reconnect + status: 'offline' gönderir
```

### OPC UA Adaptörü — Bağlantı Yaşam Döngüsü

```
1. Worker 'start' alır → OpcUaAdapter.connect()
2. Client PKI'si hazırlanır (certificate.manager):
   ├── data/pki/own/ altında self-signed istemci sertifikası yoksa OTOMATİK üretilir
   │   (CN=OE-MES-Client, 2048-bit RSA, 5 yıl geçerlilik)
   └── trusted/ + rejected/ klasörleri doğrulanır
3. OPCUAClient oluşturulur:
   ├── endpointUrl, securityMode, securityPolicy, connectionStrategy
   │   (initialRetry, maxRetry: sonsuz, randomisation, exponential backoff 1s→30s)
   └── Kimlik doğrulama: anonymous | username+password (DB'den çözülür) | sertifika
4. client.connect() → session create/activate
5. Subscribe modundaki tag'ler için:
   ├── Subscription oluştur (publishing interval gruplarına göre)
   └── Her tag için MonitoredItem ekle (deadband filtresi dahil)
6. Poll modundaki tag'ler için setInterval grupları kur
7. Veri → MessagePort → Ana Thread

Bağlantı kopması:
  ├── node-opcua connectionStrategy otomatik reconnect dener
  ├── Session reactivation denenir (subscription'lar korunur)
  ├── Başarısızsa yeni session + subscription'lar sıfırdan kurulur
  └── Ana thread'e status: 'offline' + hata mesajı gönderilir
```

### OPC UA Sertifika Güven Yönetimi (Trust On-First-Use)

```
data/pki/
├── own/
│   ├── client_certificate.pem      # Otomatik üretilen self-signed istemci sertifikası
│   └── client_private_key.pem
├── trusted/                        # Güvenilen sunucu sertifikaları (*.pem)
└── rejected/                       # Reddedilen/bekleyen sertifikalar (*.pem)
```

```
İlk bağlantı (SecurityMode = Sign veya SignAndEncrypt):
  1. Sunucu sertifikası trusted/ listesinde DEĞİLSE → bağlantı reddedilir
  2. Sertifika rejected/ klasörüne + opcua_trusted_certs tablosuna 'pending' olarak yazılır
  3. Frontend'e ws 'system:notification' + PLC durumu 'cert_pending' gösterilir
  4. Admin → CertificateTrustPanel'den sertifikayı inceler (subject, thumbprint)
  5. "Güven" → trusted/ klasörüne taşınır, DB status='trusted', audit_log'a yazılır
  6. Worker otomatik yeniden bağlanır → bağlantı başarılı
  7. "Reddet" → status='rejected' kalır, bağlantı denemeleri engellenir
```

> [!IMPORTANT]
> Sunucu tarafında da OE MES istemci sertifikasının (`data/pki/own/client_certificate.pem`) sunucunun trust listesine eklenmesi gerekir. Bunun için PLC detay ekranında "İstemci Sertifikasını İndir" butonu sunulur.

### Kimlik Bilgisi Şifreleme (Secret Storage)

- OPC UA kullanıcı şifreleri DB'de **asla düz metin** tutulmaz.
- `secret.service.ts`: AES-256-GCM; anahtar `ENCRYPTION_KEY` ortam değişkeninden (64 hex karakter = 32 byte) alınır.
- `ENCRYPTION_KEY` tanımlı değilse `JWT_SECRET`'tan scrypt ile türetilir ve başlangıçta uyarı loglanır.
- Format: `enc:v1:<iv>:<authTag>:<ciphertext>` (base64).

### Veri Akışı (Aktif İş Emri)

```
PLC / OPC UA Sunucu → Worker Thread → MessagePort → WorkerManager → iki yol:
  │
  ├── 1) WebSocket Manager → Frontend Dashboard (canlı görüntüleme)
  │
  └── 2) DataCollector Service → SQLite INSERT (sadece ACTIVE iş emri varsa)
        ├── Transaction batching: Her 1 saniyede biriken INSERT'leri
        │   tek BEGIN...COMMIT bloğunda yazar
        └── quality='bad' olan değerler NULL + quality='bad' olarak kaydedilir
```

### PLC Otomatik Başlatma (Server Boot)

```
Server başlar → ModuleLoader modülleri yükler → PLC Gateway modülü yüklenir
  │
  └── WorkerManager başlar
        └── DB'den is_active=1 olan tüm PLC profillerini okur
              └── Her aktif PLC için Worker Thread oluşturur ve bağlantı kurar
                    ├── Başarılı → status: 'online'
                    ├── OPC UA sertifika onayı bekliyorsa → status: 'cert_pending'
                    └── Başarısız → status: 'offline' + otomatik retry (5sn aralıkla)
```

> [!NOTE]
> PLC profili `is_active=1` olan cihazlar sunucu başladığında otomatik olarak bağlantı kurar. Ayrıca elektrik kesintisi vb. durumlarda sunucu yeniden başladığında, durumu `active` olan iş emirleri **otomatik olarak veri toplamaya kaldığı yerden devam eder**. Kullanıcı isterse PLC yönetim panelinden manuel olarak başlatıp durdurabilir.

---

## REST API Tasarımı

### Standart Hata Yanıt Formatı

Tüm API hataları aynı zarf (envelope) formatında döner:

```json
{
  "error": {
    "code": "PLC_CONNECTION_FAILED",
    "message": "192.168.1.100:502 adresine bağlanılamadı (timeout)",
    "details": { "plcId": 3, "retries": 5 }
  }
}
```

| HTTP Kodu | Kullanım |
|-----------|----------|
| 400 | Validasyon hatası (`VALIDATION_ERROR`) |
| 401 | Kimlik doğrulama hatası (`UNAUTHORIZED`, `TOKEN_EXPIRED`) |
| 403 | Yetki hatası (`FORBIDDEN`) |
| 404 | Kaynak bulunamadı (`NOT_FOUND`) |
| 409 | Çakışma (`DUPLICATE_NAME`, `WORK_ORDER_ACTIVE` vb.) |
| 502 | Saha cihazı hatası (`PLC_CONNECTION_FAILED`, `OPCUA_SESSION_FAILED`, `OPCUA_CERT_UNTRUSTED`) |
| 500 | Sunucu hatası (`INTERNAL_ERROR`) |

### Kimlik Doğrulama

| Method | Endpoint | Açıklama |
|--------|----------|----------|
| POST | `/api/auth/login` | Kullanıcı girişi (JWT döner; `must_change_password` bayrağı döner) |
| POST | `/api/auth/logout` | Oturum sonlandırma |
| GET | `/api/auth/me` | Mevcut kullanıcı bilgisi |
| POST | `/api/auth/change-password` | Şifre değiştirme (ilk giriş zorunluluğu dahil) |

### PLC / OPC UA Sunucu Yönetimi

| Method | Endpoint | Açıklama |
|--------|----------|----------|
| GET | `/api/plc` | Tüm PLC/OPC UA profilleri |
| POST | `/api/plc` | Yeni profil oluştur (protokol: modbus_tcp / modbus_rtu / opcua) |
| GET | `/api/plc/:id` | Profil detayı (şifre alanı asla dönmez) |
| PUT | `/api/plc/:id` | Profil güncelle |
| DELETE | `/api/plc/:id` | Profil sil |
| POST | `/api/plc/:id/test` | Bağlantı testi (OPC UA: endpoint + security + auth doğrulaması) |
| POST | `/api/plc/:id/start` | Worker'ı başlat |
| POST | `/api/plc/:id/stop` | Worker'ı durdur |
| GET | `/api/plc/:id/status` | Bağlantı durumu (`online` / `offline` / `cert_pending`) |

### OPC UA'ya Özgü Endpoint'ler

| Method | Endpoint | Açıklama |
|--------|----------|----------|
| GET | `/api/plc/:id/browse?nodeId=` | Adres alanı gezinme (nodeId boş → ObjectsFolder kökü). Dönen `BrowseNode[]` |
| GET | `/api/plc/:id/certificates` | Sunucu sertifikaları listesi (pending/trusted/rejected) |
| POST | `/api/plc/:id/certificates/:thumbprint/trust` | Sertifikaya güven → trusted/ klasörüne taşı + worker'ı yeniden bağla |
| POST | `/api/plc/:id/certificates/:thumbprint/reject` | Sertifikayı reddet |
| GET | `/api/plc/:id/certificates/client` | OE MES istemci sertifikasını indir (sunucuya eklemek için PEM) |

### Tag Yönetimi

| Method | Endpoint | Açıklama |
|--------|----------|----------|
| GET | `/api/plc/:plcId/tags` | PLC'nin tag listesi |
| POST | `/api/plc/:plcId/tags` | Yeni tag oluştur (adres: Modbus `40001` veya OPC UA NodeId) |
| PUT | `/api/tags/:id` | Tag güncelle |
| DELETE | `/api/tags/:id` | Tag sil |
| POST | `/api/tags/read` | Manuel tag okuma |
| POST | `/api/tags/write` | Manuel tag yazma |

### Reçete Yönetimi

| Method | Endpoint | Açıklama |
|--------|----------|----------|
| GET | `/api/recipes` | Tüm reçeteler |
| POST | `/api/recipes` | Yeni reçete oluştur |
| GET | `/api/recipes/:id` | Reçete detayı (tag eşleştirmeleri ile) |
| PUT | `/api/recipes/:id` | Reçete güncelle |
| DELETE | `/api/recipes/:id` | Reçete sil |
| PUT | `/api/recipes/:id/dashboard` | Dashboard layout kaydet |

### İş Emri Yönetimi

| Method | Endpoint | Açıklama |
|--------|----------|----------|
| GET | `/api/work-orders` | Tüm iş emirleri |
| POST | `/api/work-orders` | Yeni iş emri oluştur |
| GET | `/api/work-orders/:id` | İş emri detayı |
| PUT | `/api/work-orders/:id` | İş emri güncelle |
| POST | `/api/work-orders/:id/activate` | İş emrini başlat |
| POST | `/api/work-orders/:id/pause` | İş emrini duraklat |
| POST | `/api/work-orders/:id/resume` | İş emrini sürdür |
| POST | `/api/work-orders/:id/complete` | İş emrini tamamla |
| POST | `/api/work-orders/:id/archive` | İş emrini arşivle |
| GET | `/api/work-orders/:id/data` | Toplanan veri (zaman serisi) |

### Dashboard

| Method | Endpoint | Açıklama |
|--------|----------|----------|
| GET | `/api/dashboard/active` | Aktif iş emri dashboard listesi |
| GET | `/api/dashboard/:workOrderId` | Belirli WO'nun dashboard layout'u |

### Kullanıcı Yönetimi

| Method | Endpoint | Açıklama |
|--------|----------|----------|
| GET | `/api/users` | Kullanıcı listesi |
| POST | `/api/users` | Kullanıcı oluştur |
| PUT | `/api/users/:id` | Kullanıcı güncelle |
| DELETE | `/api/users/:id` | Kullanıcı sil |
| GET | `/api/permissions` | Yetki konfigürasyonu |
| PUT | `/api/permissions` | Yetki güncelle |

### Sistem Ayarları

| Method | Endpoint | Açıklama |
|--------|----------|----------|
| GET | `/api/settings` | Tüm sistem ayarları |
| PUT | `/api/settings` | Ayarları güncelle |
| GET | `/api/modules` | Modül durumları |
| PUT | `/api/modules/:id` | Modül aç/kapa |
| POST | `/api/archive` | DB arşivleme tetikle |
| GET | `/api/audit` | Audit log sorgula |
| GET | `/api/health` | Sağlık kontrolü: `{ status, uptime, db: 'ok', workers: [{plcId, status}] }` (auth gerekmez) |

---

## WebSocket Olay Katalogu

### Bağlantı Yönetimi

- **Heartbeat:** Server her 30 sn'de bir `ping` frame gönderir; 2 ardışık ping cevapsız kalırsa bağlantıyı kapatır. Client `pong` ile cevap verir (tarayıcı otomatik yapar).
- **Reconnect:** Client exponential backoff ile yeniden bağlanır (1s → 2s → 5s → 10s → max 30s). Token süresi dolmuşsa önce REST ile token tazelenir, sonra WS yeniden kurulur.

### Server → Client

| Olay | Payload | Açıklama |
|------|---------|----------|
| `plc:data` | `{ plcId, tags: [{tagId, value, quality, timestamp}] }` | Canlı tag değerleri (Modbus poll + OPC UA subscription/poll) |
| `plc:status` | `{ plcId, status: 'online'/'offline'/'cert_pending', message }` | Cihaz bağlantı durumu |
| `opcua:cert_pending` | `{ plcId, thumbprint, subject }` | OPC UA sunucu sertifikası güven onayı bekliyor |
| `workorder:changed` | `{ workOrderId, status, changedBy }` | İş emri durum değişikliği |
| `system:notification` | `{ type, message, severity }` | Sistem bildirimleri (DB boyut uyarısı dahil) |

### Client → Server

| Olay | Payload | Açıklama |
|------|---------|----------|
| `subscribe:plc` | `{ plcIds: number[] }` | PLC verilerine abone ol |
| `unsubscribe:plc` | `{ plcIds: number[] }` | Aboneliği kaldır |
| `subscribe:workorder` | `{ workOrderId }` | İş emri verilerine abone ol |

---

## Docker Compose Yapısı

```yaml
# docker-compose.yml
version: '3.8'

services:
  mes-app:
    build:
      context: .
      dockerfile: Dockerfile
    ports:
      - "3000:3000"       # HTTP + WebSocket
    volumes:
      - mes-data:/app/data        # SQLite DB dosyaları + data/pki (OPC UA sertifikaları)
      - mes-uploads:/app/uploads  # Logo vb.
    environment:
      - NODE_ENV=production
      - DB_PATH=/app/data/mes.db
      - JWT_SECRET=${JWT_SECRET}
      - ENCRYPTION_KEY=${ENCRYPTION_KEY}   # OPC UA şifreleri için AES-256 anahtarı (64 hex)
      - PORT=3000
    restart: unless-stopped
    # RTU için gerekirse:
    # devices:
    #   - /dev/ttyUSB0:/dev/ttyUSB0

volumes:
  mes-data:
  mes-uploads:
```

```dockerfile
# Dockerfile
FROM node:20-alpine

WORKDIR /app

# Backend build
COPY packages/backend/package*.json ./packages/backend/
RUN cd packages/backend && npm ci --production=false

COPY packages/backend/ ./packages/backend/
RUN cd packages/backend && npm run build

# Frontend build
COPY packages/frontend/package*.json ./packages/frontend/
RUN cd packages/frontend && npm ci

COPY packages/frontend/ ./packages/frontend/
RUN cd packages/frontend && npm run build

# Frontend static dosyalarını backend'e kopyala
RUN cp -r packages/frontend/dist packages/backend/dist/public

# Production bağımlılıkları
RUN cd packages/backend && npm prune --production

EXPOSE 3000

CMD ["node", "packages/backend/dist/server.js"]
```

> [!IMPORTANT]
> Fastify, frontend build çıktısını statik dosya olarak sunacak (fastify-static). Tek port (3000) üzerinden hem API hem frontend çalışacak.

> [!NOTE]
> `node-opcua` saf JavaScript/TypeScript'tir; native derleme gerektirmez, bu yüzden `node:20-alpine` imajında ek paket gerekmeden çalışır. OPC UA istemci sertifikaları `data/pki/` altında olduğundan `mes-data` volume'ü ile kalıcıdır.

---

## Uygulama Aşamaları (Implementation Phases)

### Faz 1: Temel Altyapı ⏱️ ~3 gün
- [ ] Monorepo proje yapısı oluşturma
- [ ] Backend: Fastify + TypeScript kurulumu
- [ ] SQLite bağlantı + WAL modu + versiyonlu migration sistemi (schema_migrations)
- [ ] Frontend: Vite + React + TypeScript kurulumu
- [ ] CSS tasarım sistemi (variables, tema, dark/light)
- [ ] Layout (Sidebar + Header + Content alanı)
- [ ] i18n altyapısı (TR/EN)
- [ ] Auth sistemi (login sayfası, JWT, bcrypt, ilk giriş şifre değiştirme zorunluluğu)
- [ ] Varsayılan admin:admin kullanıcı seed (must_change_password=1)
- [ ] Standart API hata zarfı + `/api/health` endpoint'i
- [ ] Modül sistemi (registry + loader)
- [ ] Docker Compose dosyası

### Faz 2: PLC Gateway (Modbus + OPC UA) ⏱️ ~4 gün
- [ ] PLC profil CRUD (frontend + backend, protokole göre dinamik form)
- [ ] Tag tanımlama CRUD (frontend + backend, protokole göre adres alanı)
- [ ] Worker Thread yöneticisi (WorkerManager)
- [ ] Modbus TCP adaptörü
- [ ] Modbus RTU adaptörü
- [ ] **OPC UA adaptörü (node-opcua)** — bağlantı yaşam döngüsü + reconnect
- [ ] **OPC UA subscription motoru** — MonitoredItem yönetimi, publishing interval grupları, deadband
- [ ] **OPC UA browse servisi + NodeBrowserDialog** (sunucu adres alanından node seçimi)
- [ ] **Sertifika güven yönetimi** — PKI dizini, otomatik istemci sertifikası, trust/reject akışı, CertificateTrustPanel
- [ ] **Kimlik bilgisi şifreleme** (AES-256-GCM, ENCRYPTION_KEY)
- [ ] Bağlantı testi (Test Connection — her üç protokol)
- [ ] Online/Offline/CertPending durum gösterimi
- [ ] WebSocket ile canlı veri akışı
- [ ] Manuel okuma/yazma sayfası (ReadWritePanel)
- [ ] Canlı Monitör ekranı (LiveMonitor)
- [ ] Runtime PLC ekleme/çıkarma

### Faz 3: Reçete Yönetimi ⏱️ ~2 gün
- [ ] Reçete CRUD (frontend + backend)
- [ ] Tag eşleştirme arayüzü (TagMapper)
- [ ] Boş dashboard canvas oluşturma (reçete ile ilişkili)
- [ ] Dashboard template editörü (react-grid-layout ile sürükle-bırak)
- [ ] Reçete koruma kuralları (silme/düzenleme engeli)

### Faz 4: İş Emri Yönetimi ⏱️ ~2 gün
- [ ] İş emri CRUD (frontend + backend)
- [ ] Otomatik numara üretimi (WO-YYYYMMDD-NNN)
- [ ] Durum makinesi (draft → active → paused → completed → archived)
- [ ] DataCollector servisi (aktif WO için DB'ye yazma, quality + value_text desteği)
- [ ] Transaction batching (performans optimizasyonu)
- [ ] Yetkilendirme (hangi roller yönetebilir)

### Faz 5: Dashboard ⏱️ ~3 gün
- [ ] Widget sistemi altyapısı
- [ ] Widget paleti (sidebar — widget tiplerini sürükle)
- [ ] Widget konfigürasyon paneli (popup/sidebar — tag binding, display options)
- [ ] NumericWidget (büyük sayısal gösterge)
- [ ] GaugeWidget (ibreli gösterge — custom SVG)
- [ ] TrendChartWidget (Recharts canlı çizgi grafik)
- [ ] StatusWidget (yeşil/kırmızı durum LED'i)
- [ ] TableWidget (çoklu değer tablosu)
- [ ] WebSocket ile gerçek zamanlı güncelleme
- [ ] Aktif iş emirleri arası geçiş
- [ ] Reçete preview modu

### Faz 6: Sistem Yönetimi ⏱️ ~2 gün
- [ ] Kullanıcı yönetimi CRUD
- [ ] Operator yetki konfigürasyonu
- [ ] Sistem ayarları paneli (timeout, dil, tema, DB boyut uyarı eşiği)
- [ ] Modül yönetimi (açma/kapama toggle)
- [ ] Branding ayarları (logo + firma adı + "Powered by OE")
- [ ] DB arşivleme (interlock + rename + reset)
- [ ] Audit trail görüntüleyici

### Faz 7: PWA & Polish ⏱️ ~2 gün
- [ ] Service Worker (vite-plugin-pwa)
- [ ] Offline cache stratejisi
- [ ] Manifest + ikonlar
- [ ] Ana ekrana ekleme desteği
- [ ] Responsive düzenleme (mobil/tablet)
- [ ] Genel UX iyileştirmeleri
- [ ] Docker production optimizasyonu

---

## Doğrulama Planı

### Otomatik Testler
```bash
# Backend API testleri
cd packages/backend && npm test

# Frontend build kontrolü
cd packages/frontend && npm run build

# TypeScript tip kontrolü
cd packages/backend && npx tsc --noEmit
cd packages/frontend && npx tsc --noEmit
```

### Test Simülatörleri (Saha Cihazı Olmadan Geliştirme)

| Script | Açıklama |
|--------|----------|
| `scripts/modbus-sim.mjs` | Lokal Modbus TCP sunucusu (127.0.0.1:5020) — ramp/random/sine register değerleri |
| `scripts/opcua-sim.mjs` | Lokal OPC UA sunucusu (opc.tcp://127.0.0.1:4840) — ns=2 altında test tag'leri (Boolean, Int16, Float, String, sine üreteci). SecurityMode=None ve SignAndEncrypt profilleri ile çalıştırılabilir |
| `scripts/ws-test.mjs` | WebSocket bağlantı + `plc:data` akışı doğrulama |

### OPC UA Uçtan Uca Frontend Test Rehberi (Adım Adım)

Bu rehber, Faz 1 + Faz 2 tamamlandıktan sonra OPC UA haberleşmesinin **tamamen frontend üzerinden** doğrulanması için izlenir. Gerçek PLC/SCADA gerekmez; tüm senaryolar `opcua-sim.mjs` simülatörü ile yapılır.

#### Ön Koşullar

```bash
# 1. Backend + frontend çalışıyor olmalı
npm run dev:backend     # terminal 1 → http://localhost:3000
npm run dev:frontend    # terminal 2 → http://localhost:5173

# 2. OPC UA simülatörünü başlat (terminal 3)
node scripts/opcua-sim.mjs                  # Temel mod: SecurityMode=None, anonymous
node scripts/opcua-sim.mjs --secure         # Güvenli mod: SignAndEncrypt + Basic256Sha256
node scripts/opcua-sim.mjs --auth test:test123   # Kullanıcı adı/şifre zorunlu mod
```

Simülatör endpoint'i: `opc.tcp://127.0.0.1:4840`

**Simülatör Test Tag'leri** (tümü `ns=2` namespace'inde):

| NodeId | Tip | Davranış | Test Amacı |
|--------|-----|----------|-----------|
| `ns=2;s=Sim.Bool` | BOOL | 1 sn'de bir toggle | StatusWidget, subscribe |
| `ns=2;s=Sim.Counter` | UINT16 | Sürekli artan sayaç | NumericWidget, data_log |
| `ns=2;s=Sim.Temperature` | FLOAT32 | 20–80 °C arası sine | Gauge + Trend widget |
| `ns=2;s=Sim.Pressure` | FLOAT32 | 1–10 bar random | Trend, deadband testi |
| `ns=2;s=Sim.Status` | STRING | "RUNNING"/"STOPPED" | value_text kaydı |
| `ns=2;s=Sim.Setpoint` | FLOAT32 | Statik, **yazılabilir** | Manuel yazma testi |

#### Senaryo 1 — Temel Bağlantı (SecurityMode=None)

| # | Adım (Frontend) | Beklenen Sonuç ✓ |
|---|-----------------|-------------------|
| 1 | `admin` ile giriş yap | Dashboard açılır |
| 2 | **PLC Yönetimi** (`/plc`) → "Yeni Profil" | PlcForm açılır |
| 3 | Protokol: **OPC UA** seç | Form OPC UA alanlarına geçer (OpcUaConfigPanel) |
| 4 | Endpoint: `opc.tcp://127.0.0.1:4840`, Security Mode: `None`, Policy: `None`, Auth: `anonymous` | — |
| 5 | **"Bağlantıyı Test Et"** butonuna bas | ✅ "Bağlantı başarılı" bildirimi |
| 6 | Kaydet | PLC listesinde durum **online** (yeşil) |
| 7 | Tarayıcı DevTools → Network → WS | `plc:status { status: 'online' }` mesajı görülür |

#### Senaryo 2 — Browse ile Tag Ekleme (NodeBrowserDialog)

| # | Adım | Beklenen Sonuç ✓ |
|---|------|-------------------|
| 1 | PLC satırı → **Tag'ler** (`/plc/:id/tags`) → "Yeni Tag" | TagForm açılır |
| 2 | Adres alanının yanındaki **"Gözat"** butonuna bas | NodeBrowserDialog açılır, `Objects` kökü listelenir |
| 3 | `Sim` klasörüne in → `Sim.Temperature` node'unu seç | Adres `ns=2;s=Sim.Temperature` ve veri tipi `FLOAT32` **otomatik dolar** |
| 4 | Mod: `subscribe`, Periyot: `1000 ms`, Birim: `°C` | — |
| 5 | Kaydet | Tag listede görünür |

#### Senaryo 3 — Subscription Canlı Veri Akışı

| # | Adım | Beklenen Sonuç ✓ |
|---|------|-------------------|
| 1 | **Canlı Monitör** (`/plc/live-monitor`) ekranını aç | Tag değerleri ~1 sn'de bir güncellenir |
| 2 | DevTools → Network → WS → Messages | `plc:data { tags: [{ tagId, value, quality: 'good' }] }` akışı |
| 3 | `Sim.Bool` ve `Sim.Status` tag'lerini de ekle | Boolean toggle ve String değerler UI'da doğru render edilir |

#### Senaryo 4 — Manuel Okuma / Yazma

| # | Adım | Beklenen Sonuç ✓ |
|---|------|-------------------|
| 1 | `/plc/read-write` → `Sim.Setpoint` → **Oku** | Güncel değer döner |
| 2 | Değer gir (örn. `42.5`) → **Yaz** | ✅ "Yazma başarılı" |
| 3 | Tekrar **Oku** | `42.5` döner; simülatör konsolunda write log'u görülür |

#### Senaryo 5 — Kopma / Yeniden Bağlanma

| # | Adım | Beklenen Sonuç ✓ |
|---|------|-------------------|
| 1 | Simülatörü durdur (Ctrl+C) | ~5 sn içinde UI'da durum **offline** (kırmızı), WS'te `plc:status offline` |
| 2 | Simülatörü tekrar başlat | Otomatik reconnect → durum **online**, veri akışı kaldığı yerden devam eder |

#### Senaryo 6 — Sertifika Trust Akışı (SignAndEncrypt)

| # | Adım | Beklenen Sonuç ✓ |
|---|------|-------------------|
| 1 | Simülatörü `node scripts/opcua-sim.mjs --secure` ile başlat | — |
| 2 | PLC profilini güncelle: Security Mode `SignAndEncrypt`, Policy `Basic256Sha256` | — |
| 3 | "Bağlantıyı Test Et" | ⛔ `OPCUA_CERT_UNTRUSTED` hatası; PLC durumu **cert_pending** (sarı) |
| 4 | `/plc/:id/certificates` sayfasına git | Bekleyen sertifika listede (subject + thumbprint görünür) |
| 5 | **"Güven"** butonuna bas | Worker otomatik yeniden bağlanır → durum **online** |
| 6 | Audit log'a bak (`/audit`) | `trust_cert` kaydı (kullanıcı, thumbprint, zaman damgası) |
| 7 | (Negatif test) Başka profilde **"Reddet"** | Bağlantı engellenir, hata mesajı anlaşılır |

#### Senaryo 7 — Username/Password Kimlik Doğrulama + Şifreli Saklama

| # | Adım | Beklenen Sonuç ✓ |
|---|------|-------------------|
| 1 | Simülatörü `--auth test:test123` ile başlat | — |
| 2 | Profilde Auth: `username`, kullanıcı: `test`, şifre: `test123` → Kaydet → Test | ✅ Bağlantı başarılı |
| 3 | DB kontrolü: `sqlite3 data/mes.db "SELECT auth_password_enc FROM plc_profiles"` | Değer `enc:v1:...` formatında; **düz metin değil** |
| 4 | Şifreyi bilerek yanlış gir → Test | ⛔ Anlaşılır hata mesajı (BadUserAccessDenied) |

#### Senaryo 8 — İş Emri ile Veri Kaydı (Entegrasyon)

| # | Adım | Beklenen Sonuç ✓ |
|---|------|-------------------|
| 1 | Reçete oluştur → OPC UA tag'lerini eşle → dashboard'a Numeric/Trend widget bağla | — |
| 2 | İş emri oluştur → **Başlat** | Dashboard'da canlı veri |
| 3 | 1–2 dk bekle → İş emri detayında geçmiş veri grafiği | `data_log`'a kayıtlar düşmüş (timestamp sıralı) |
| 4 | Simülatörü kısa süre durdur/başlat | Kesinti anında `quality='bad'` kayıtlar, sonra `good` devam |

#### Sorun Giderme (Yaygın Hatalar)

| Belirti | Muhtemel Neden | Çözüm |
|---------|----------------|-------|
| `BadTcpEndpointUrlInvalid` | Endpoint URL yanlış / simülatör kapalı | `opc.tcp://` öneki ve portu (4840) kontrol et; simülatör çalışıyor mu? |
| `BadSecurityChecksFailed` | Sertifika güvenilmemiş | `/plc/:id/certificates` → Trust akışı (Senaryo 6) |
| `BadUserAccessDenied` | Yanlış kullanıcı/şifre | Simülatör `--auth` parametresiyle eşleştiğini doğrula |
| `BadNodeIdUnknown` | NodeId yazım hatası | Elle girmek yerine "Gözat" ile seç |
| Veri gelmiyor ama online | Tag `poll` modda kalmış / deadband yüksek | `acquisition_mode=subscribe` yap, deadband=0 dene |
| WS mesajı yok | Token süresi dolmuş | Sayfayı yenile; WS reconnect + token tazeleme devreye girmeli |

### Manuel Doğrulama
1. **Auth**: Login/logout, JWT token yenileme, timeout, ilk giriş şifre değiştirme
2. **PLC (Modbus)**: Profil oluşturma, test connection, online/offline durumu
3. **PLC (OPC UA)**:
   - SecurityMode=None ile opcua-sim'e bağlanma
   - SignAndEncrypt + sertifika trust akışı (pending → trust → online)
   - NodeBrowserDialog ile adres alanından tag seçimi
   - Subscription veri akışı; kablo kopması/yeniden bağlanma senaryosu
   - Username/password kimlik doğrulama (DB'de şifreli saklandığının kontrolü)
4. **Tag**: Tag ekleme, farklı veri tipleri, polling periyotları, subscribe modu, ölçekleme (scale/offset)
5. **Reçete**: Oluşturma, tag eşleştirme, dashboard template
6. **İş Emri**: Tüm durum geçişleri, çoklu aktif WO
7. **Dashboard**: Widget'lar, canlı veri, sürükle-bırak
8. **Arşivleme**: Interlock kontrolü, dosya yeniden adlandırma
9. **PWA**: Offline çalışma, ana ekrana ekleme
10. **Docker**: `docker-compose up` ile tam sistem testi

---

## Düzeltilen / Eklenen Konular (v2)

### ✅ Dashboard Widget Konfigürasyonu (Düzeltildi)

Widget'lar artık tag mapping ile **gelmeyecek**. Yeni akış:

```
1. Reçete oluşturulur → Boş dashboard canvas oluşur
2. Kullanıcı sol paneldeki Widget Paleti'nden widget tipini sürükler
3. Widget canvas'a boş olarak yerleşir (henüz veri bağlı değil)
4. Kullanıcı widget'a tıklar → Konfigürasyon Paneli (popup/sidebar) açılır
5. Panelde seçenekler:
   ├── Veri Kaynağı: Reçetedeki tag listesinden seçim
   ├── Görüntüleme: Widget tipine göre ayarlar
   │     ├── Gauge: min, max, uyarı eşiği, renk aralıkları
   │     ├── Numeric: birim, ondalık basamak
   │     ├── Trend: zaman penceresi, Y ekseni aralığı
   │     ├── Status: açık/kapalı label'ları, renkler
   │     └── Table: sütun seçimi, sıralama
   └── Başlık: Widget başlık metni
6. Kaydet → Layout + widget konfigürasyonları reçete ile birlikte JSON olarak saklanır
```

### ✅ DB Arşivleme Mekanizması (Netleştirildi)

Arşivleme sırasında **konfigürasyon tabloları korunur**, sadece `data_log` temizlenir:

```
1. Kullanıcı "Arşivle" butonuna basar
2. Sistem kontrol: Aktif iş emri var mı?
   ├── EVET → ⛔ Hata: "Aktif iş emri varken arşivleme yapılamaz"
   └── HAYIR → ✅ Devam
3. Mevcut DB dosyası KOPYALANIR: mes_data_2026-07-15.db (tam arşiv)
4. Aktif DB'de sadece data_log tablosu temizlenir:
   DELETE FROM data_log;
   -- users, plc_profiles, plc_tags, recipes, work_orders vb. KORUNUR
5. Tamamlanan iş emirleri arşivde kalır, aktif DB'de de kalır
   (referans bütünlüğü için)
6. Sistem çalışmaya devam eder
```

> [!IMPORTANT]
> Arşiv dosyası tam bir DB kopyasıdır — ileride arşiv browser arayüzü ile açılıp incelenebilir. Aktif DB'de sadece `data_log` silinir, tüm konfigürasyon ve iş emri geçmişi korunur.

### ✅ WebSocket Kimlik Doğrulama (Eklendi)

```
1. Client WebSocket bağlantısı kurar: ws://host:3000/ws?token=JWT_TOKEN
2. Server bağlantıyı kabul etmeden JWT'yi doğrular
3. Geçersiz token → Bağlantı reddedilir (4001 kodu)
4. Token timeout → Bağlantı kapatılır, client yeniden bağlanır
```

### ✅ Oturum Saklama Stratejisi (Eklendi)

| Ortam | Strateji | Gerekçe |
|-------|----------|--------|
| Web (tarayıcı) | httpOnly cookie | XSS koruması, air-gapped ortamda uygun |
| PWA | httpOnly cookie + refresh token | Offline durumda son oturumu koru |

### ✅ Frontend Routing Haritası (Eklendi)

```
/login                          → Login sayfası (public)
/change-password                → Zorunlu şifre değiştirme (ilk giriş)
/                               → Dashboard (ana sayfa, protected)
/dashboard/:workOrderId         → Belirli iş emri dashboard'u
/work-orders                    → İş emri listesi
/work-orders/new                → Yeni iş emri
/work-orders/:id                → İş emri detayı
/recipes                        → Reçete listesi
/recipes/new                    → Yeni reçete
/recipes/:id                    → Reçete detay + tag mapping
/recipes/:id/dashboard          → Dashboard template editörü
/plc                            → PLC / OPC UA sunucu yönetimi
/plc/:id/tags                   → Tag listesi
/plc/:id/certificates           → OPC UA sertifika güven yönetimi (admin)
/plc/live-monitor               → Canlı monitör (aktif WO'suz izleme)
/plc/read-write                 → Manuel okuma/yazma
/users                          → Kullanıcı yönetimi (admin)
/settings                       → Sistem ayarları (admin)
/settings/modules               → Modül yönetimi (admin)
/settings/branding              → Branding ayarları (admin)
/settings/archive               → Arşivleme (admin)
/audit                          → Audit trail (admin)
```

### ✅ Dashboard Yetkilendirme ve Canlı İzleme (Eklendi)

- **Dashboard Görünümü:** İş emri içerisindeki dashboard **sabit (view-only)**'dir. Operatörler aktif iş emrindeki grafikleri veya widget'ları düzenleyemez. Dashboard şablonu (template) sadece yetkili kişiler (Admin/Supervisor) tarafından **Reçete (Recipe)** ekranında değiştirilebilir.
- **Canlı İzleme (Live Monitoring):** Herhangi bir aktif iş emri yokken de makine durumunu izleyebilmek için iki noktada canlı izleme sunulacaktır:
  1. PLC Yönetimi altında "Canlı Monitör (Live Monitor)" ekranı.
  2. Reçete detay ekranında "Preview (Önizleme)" butonu.

### ✅ DB Arşivleme Uyarısı (Eklendi)

Veritabanının aşırı büyümesini önlemek amacıyla, SQLite dosya boyutu **belirlenen bir sınırı (örn: 2GB) aştığında** sistem genelinde yöneticilere "Veritabanı boyutu X GB'a ulaştı, lütfen arşivleme yapınız" şeklinde bir bildirim/uyarı çıkarılacaktır.

---

## Düzeltilen / Eklenen Konular (v3)

### ✅ OPC UA Tam Destek (Stub Kaldırıldı, Devreye Alındı)

- `opcua.adapter.stub.ts` kaldırıldı; yerine tam işlevsel **`opcua.adapter.ts`** (node-opcua tabanlı), `opcua-browser.service.ts` ve `certificate.manager.ts` eklendi.
- `plc_profiles.protocol` CHECK kısıtına `'opcua'` eklendi; OPC UA'ya özgü alanlar (`endpoint_url`, `security_mode`, `security_policy`, `auth_type`, `auth_username`, `auth_password_enc`, `session_timeout_ms`) tabloya işlendi.
- Veri toplama **subscription-first** modeline geçirildi: OPC UA tag'leri varsayılan olarak MonitoredItem ile izlenir; sunucu desteklemezse veya tag `acquisition_mode='poll'` ise polling'e düşülür.
- Sertifika güven yönetimi (TOFU — Trust On First Use) UI + API + PKI dizin yapısı ile tanımlandı.
- OPC UA test simülatörü (`scripts/opcua-sim.mjs`) planlandı.

### ✅ Protokol-Bazlı Tag Adresleme (Düzeltildi)

`plc_tags.address` alanı `INTEGER` → `TEXT` olarak değiştirildi. Modbus için mutlak register (`40001`), OPC UA için NodeId (`ns=2;s=...`) aynı kolonda protokol bazlı yorumlanır. `register_type` yalnız Modbus'ta anlamlıdır. Veri tiplerine `INT64`, `UINT64`, `STRING` eklendi.

### ✅ `data_log` Kalite ve Metin Değer Desteği (Eklendi)

OPC UA veri kalitesi (`good`/`uncertain`/`bad`) ve STRING tipli tag değerleri için `quality` ve `value_text` kolonları eklendi. `quality='bad'` değerler NULL olarak kaydedilir.

### ✅ Tag Ölçekleme ve Deadband (Eklendi)

- `scale_factor` + `value_offset`: ham değer → mühendislik birimi dönüşümü (`gösterilen = ham * scale + offset`).
- `deadband`: OPC UA subscription absolute deadband filtresi (gereksiz veri trafiğini azaltır).

### ✅ Kimlik Bilgisi Şifreleme (Eklendi)

OPC UA kullanıcı şifreleri AES-256-GCM ile şifrelenerek saklanır (`auth_password_enc`). Anahtar `ENCRYPTION_KEY` ortam değişkeninden gelir; tanımsızsa `JWT_SECRET`'tan scrypt ile türetilir (uyarı loglanır).

### ✅ Operasyonel Eksiklerin Tamamlanması (Eklendi)

| Eksik | Çözüm |
|-------|-------|
| Migration versiyonlama | `schema_migrations` tablosu + immutable sıralı migration dizisi + öncesi otomatik DB yedeği |
| Sağlık kontrolü | `GET /api/health` (uptime, DB durumu, worker durumları) |
| API hata formatı | Standart hata zarfı: `{ error: { code, message, details } }` + HTTP kod tablosu |
| WebSocket heartbeat | 30 sn ping; client exponential backoff reconnect (max 30 sn) |
| İlk giriş şifre değişikliği | `users.must_change_password` + `/change-password` rotası + `POST /api/auth/change-password` |
| Varsayılan ayarlar | Seed listesi (session timeout, şifre min uzunluk, DB boyut uyarı eşiği, WS heartbeat) |
| OPC UA sertifika denetimi | `audit_log`'a `trust_cert` aksiyonu, `opcua_trusted_certs` tablosu |

---

## Onaylanan Kararlar

- ✅ Monorepo yapısı (`packages/backend` + `packages/frontend`) onaylandı
- ✅ Docker Compose deployment onaylandı
- ✅ Widget'lar boş gelir, konfigürasyon popup/sidebar ile yapılır
- ✅ "OE" branding, "Powered by OE" + müşteri logosu
- ✅ Modbus adreslemesi mutlak değer (40001) olarak girilir
- ✅ Sunucu yeniden başlarken aktif iş emirleri veri toplamaya otomatik devam eder
- ✅ **OPC UA protokolü tam destek olarak devrede** (node-opcua; stub değil)
- ✅ **Tag adresi TEXT**: Modbus `40001`, OPC UA NodeId (`ns=2;s=...`)
- ✅ **OPC UA'da varsayılan veri toplama modu: subscription**; fallback polling
- ✅ **OPC UA sunucu sertifikaları admin onayıyla güvenilir listeye alınır** (TOFU)
- ✅ **PLC/OPC UA kimlik bilgileri DB'de AES-256-GCM ile şifreli saklanır**

> [!NOTE]
> Tahmini toplam süre: **~18 iş günü** (tek geliştirici bazında). Bu süre, UI tasarımının kalitesine ve test yoğunluğuna göre değişebilir.