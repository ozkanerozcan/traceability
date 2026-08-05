# System Patterns — OE MES

## Architecture Overview
Monorepo (npm workspaces): `packages/backend` (Fastify + SQLite + Worker Threads) and `packages/frontend` (React SPA). Production: single Node process serves API, WebSocket, and static frontend on port 3000.

## Backend Patterns

### Module System (`core/module-system/`)
- `IModule` interface: `{ id, name, version, dependencies?, register(app, options), onEnable?, onDisable?, onShutdown? }`.
- `module.registry.ts` holds all modules; `module.loader.ts` reads enabled state from `modules` DB table and calls `register()` for enabled ones.
- All modules registered in `modules/index.ts` → `registerAllModules()` (called in `app.ts` **before** `moduleLoader.loadAll(app)`).
- Currently registered: `plc-gateway`, `recipe`, `work-order`, `user-management`, `system-settings`, `traceability`.

### App Bootstrap (`app.ts` → `server.ts`)
Order: `getDb()` → `runMigrations(db)` → `initializeDatabase(db)` (seed) → cors → websocket → authPlugin → `/api/health` (public) → authRoutes (`/api/auth`) → `wsManager.register(app)` → `registerAllModules()` → `moduleLoader.loadAll(app)` → static frontend + SPA fallback (non-`/api`, non-`/ws` GET → `index.html`).

### Database (`core/database/`)
- better-sqlite3, WAL mode, pragmas in `connection.ts`.
- **Migrations:** `schema_migrations` table `(version INTEGER PK, applied_at)`; immutable ordered migration array in `migrations.ts`; auto file backup `mes.db.bak-<timestamp>` before migrating. **Never edit an old migration — always add a new one.**
- Seed: default admin (admin/admin, `must_change_password=1`) + default `system_settings` rows.

### Auth (`core/auth/`)
- JWT via `@fastify/jwt`, httpOnly cookie strategy (XSS-safe for air-gapped web/PWA).
- bcryptjs password hashing; roles: `admin` | `supervisor` | `operator`; `role_permissions` table for operator grants.
- `auth.plugin.ts` decorates routes with verification; WS auth via `ws://host/ws?token=JWT` (reject code 4001 on invalid).

### Secrets (`core/crypto/secret.service.ts`)
- AES-256-GCM; format `enc:v1:<iv>:<authTag>:<ciphertext>` (base64). Key from `ENCRYPTION_KEY` (64 hex) else derived from `JWT_SECRET` via scrypt (startup warning). Used for `plc_profiles.auth_password_enc` — **passwords never stored/returned in plaintext**.

### WebSocket (`core/websocket/`)
- `ws.manager.ts`: rooms, heartbeat (server ping every 30s, 2 missed → close), broadcast to subscribed clients.
- Server→Client events: `plc:data`, `plc:status`, `opcua:cert_pending`, `workorder:changed`, `system:notification`.
- Client→Server: `subscribe:plc`, `unsubscribe:plc`, `subscribe:workorder`.

### PLC Gateway (`modules/plc-gateway/`)
- **Worker Thread per PLC** (`workers/plc.worker.ts`), lifecycle managed by `workers/worker.manager.ts`. Messages: main→worker `{ cmd: start|stop|read|write|updateConfig|browse }`; worker→main `{ event: data|status|error|cert_pending }`.
- **Protocol Adapter Pattern** (`adapters/`): `IProtocolAdapter` — `connect/disconnect/isConnected/readValue/writeValue/testConnection` + optional `supportsSubscription/subscribe/browse`. Implementations: `modbus-tcp.adapter.ts`, `modbus-rtu.adapter.ts`, `opcua.adapter.ts` (+ `opcua-browser.service.ts`, `certificate.manager.ts`, `value-codec.ts`).
- **Addressing:** `plc_tags.address` is TEXT — Modbus absolute register (`40001`, adapter subtracts offset) or OPC UA NodeId (`ns=2;s=...` / `ns=2;i=...`). `register_type` meaningful only for Modbus.
- **Acquisition:** Modbus always `poll` (setInterval groups by `polling_interval_ms`, batch reads). OPC UA defaults to `subscribe` (Subscription + MonitoredItem per tag, deadband filter, publishing-interval clamping), fallback `poll` (batch ReadRequest).
- **Reconnect:** node-opcua connectionStrategy infinite retry, exponential backoff 1s→30s, session reactivation then full rebuild; status events to main thread.
- **Certificate trust (TOFU):** PKI dirs `data/pki/{own,trusted,rejected}`; self-signed client cert auto-generated (`CN=OE-MES-Client`, RSA 2048, 5y). Unknown server cert → `pending` in `opcua_trusted_certs` + rejected/ dir → admin trusts via API → moved to trusted/ → worker reconnects. Audit `trust_cert`.
- **Auto-start on boot:** WorkerManager starts workers for all `is_active=1` PLC profiles; `active` work orders resume data collection after restart.

### Data Flow (active work order)
```
PLC/OPC UA → Worker Thread → MessagePort → WorkerManager →
  ├─ WebSocket Manager → frontend (live view)
  └─ DataCollector Service → SQLite INSERT (only if ACTIVE WO; 1s transaction batching;
     quality='bad' → NULL value + quality='bad')
```

### Work Order (`modules/work-order/`)
- `work-order.service.ts`: CRUD + `generateOrderNumber()` (`WO-YYYYMMDD-NNN`, gün bazlı sıra) + `TRANSITIONS` state machine (draft→active→paused→completed→archived) + `canTransition` guard. `COLLECTING_STATUSES = ['active','paused']` (DataCollector bunlara yazar).
- `work-order.routes.ts`: `/api/work-orders` — list (status/recipeId filter), get, create (draft), PUT notes (draft only), DELETE (draft only), POST `:id/activate|pause|resume|complete|archive` (409 `INVALID_TRANSITION`), GET `:id/data` (tagIds + limit). Transitions → `dataCollector.onStatusChanged` + audit + WS `workorder:changed`.
- `data-collector.service.ts`: subscribes `workerManager.onData`. Resolves tag set per collecting WO = union of `recipe_tags.tag_id` + `dashboard_layout` widget `tagId`/`tagIds`. 1s **transaction batching** flush; `quality='bad'` → value NULL + quality 'bad'; STRING → `value_text`. Boot'ta active/paused WOs için resume.

### User Management (`modules/user-management/`)
- `user.service.ts`: bcrypt, last-admin guard (rol değiştirme/silme engeli), create/reset'te `must_change_password=1`.
- `user.routes.ts`: `/api/users` admin-only CRUD. `permission.routes.ts`: `/api/permissions` GET (role_permissions + modules + types) / PUT (module×permission toggle). **`role_permissions` şu an yalnızca `/api/users`+`/api/permissions`'ı (admin-only) kapsar — diğer modüllerde henüz enforce EDİLMEZ.**

### System Settings (`modules/system-settings/`)
- `settings.service.ts` (key-value get/set), `archive.service.ts` (`archiveDatabase`: interlock — active/paused WO varsa `WORK_ORDER_ACTIVE` 409; WAL checkpoint + full copy `mes_data_<ts>.db`; yalnız `data_log` silinir), `settings.routes.ts` — `/api/settings` (GET/PUT), `/api/modules` (GET + PUT enable/disable → `restartRequired: true`), `/api/archive` (GET status: sizeMb/warnExceeded/activeWorkOrders/canArchive + POST run), `/api/audit` (paged query).

### Traceability (`modules/traceability/`) — v2 (2026-08-05)
- **Sabit istasyon tipleri** (yetenek/capability sistemi ve Rotalar KALDIRILDI — Migration 11): `qr_generate`, `trolley_read`, `funnel_screwing`, `trolley_shell_matching`, `filling`, `probing`. Her tip kendi özel ayarlarına, PLC sözleşmesine ve çalışma sayfasına sahiptir; yeni tipler ileride eklenebilir. Tanınmayan eski istasyonlar `legacy` + pasif.
- **Standart PLC sözleşmesi (`StationConfig`):** `plcId, shellIdTagId, trolleyIdTagId, slotTagId, rowTagId, triggerTagId, dataTagIds[], ackTagId, errorCodeTagId (int), errorMessageTagId, busyTagId (bool), clearOnRead, labelWidth/Height`. **Satır no ≠ slot no** (1 satır = `row_size` slot — genel ayar, varsayılan 4; 1-tabanlı).
- **Trigger akışı (`handleStationTrigger`):** yükselen kenar (plc-data-watcher, subscribe) → önceki sonuçlar temizlenir + Busy=true → sözleşme tag'leri okunur (`readContract`) → tip handler → başarıda Ack=true+ErrorCode=0 / hatada ErrorCode+ErrorMessage → Busy=false → Trigger=false (handshake). Hata kodları `PLC_ERR` (1 shell yok, 2 araba yok, 3 slot geçersiz, 4 okunmuş araba yok, 5 hedef boş, 6 PLC okuma, 7 geçersiz veri, 8 slot dolu). **Manuel tetikleme** (`POST /stations/:key/trigger`): aynı handler'lar payload ile; PLC'ye hiç yazılmaz — web'den "PLC'den gelmiş gibi" veri girişi.
- **İstasyon davranışları:** `trolley_read` → TrolleyId'yi `trace_station_runtime`'a DB'ye yazar (matching `getLastReadTrolleyCode()` ile okur; `clearOnRead` ile eski slot içeriği temizlenir); `funnel_screwing` → ShellId+Data ölçüm UPSERT; `trolley_shell_matching` → ShellId+SlotNumber + son okunan araba → `shells.trolley_id/slot_number` (slot dolu → hata 8); `filling` → TrolleyId+RowNumber+Data → satırdaki tüm shell'ler; `probing` → TrolleyId+Data → arabadaki TÜM shell'ler.
- **Ölçümler (`trace_measurements`):** `UNIQUE(shell_id, station_key, field)` → tekrar tetikte **UPSERT** (üzerine yazar); `source: 'plc' | 'manual'`; web'den **ekle/düzenle/sil** (`POST/PUT/DELETE /api/trace/measurements(/:id)`, `GET /shells/:id/measurements`, `GET /stations/:key/measurements`). Alan adı = PLC tag adı (manuel girişte serbest metin de olabilir).
- **Runtime (`trace_station_runtime`):** istasyonun son okuduğu araba + `last_capture` JSON — DB'de kalıcı (bellek-içi bağlam kaldırıldı, restart'ta kaybolmaz).
- **QR encoder** (`qr/qrcode.ts`): bağımlılıksız ISO/IEC 18004 → SVG path (değişmedi). `generateProductId()` (`SH-YYYYMMDD-NNNN`).
- `plc-data-watcher.ts`: tüm PLC'li istasyon tiplerinin `triggerTagId`'sini `workerManager.onData` akışında izler; false→true kenarında `handleStationTrigger(stationId, {source:'plc'})`.
- `trace.routes.ts`: `/api/trace/*` — stations CRUD, `POST /stations/:key/trigger`, `GET /stations/:key/context` (runtime + matching'de son okunan araba), measurements CRUD, trolleys, products (+records+measurements), qr/qr-history, alarms. `StationError` → 400/404/409/502 + `errorCode` alanı.
- **Frontend:** StationsPage tip bazlı form (tip seçimi + tipe özel sözleşme bölümleri); StationWorkPage 6 özel panel; ortak bileşenler `TrolleyGrid` (4x5), `MeasurementEditor` (ekle/düzenle/sil + önerilen alanlar), `ManualEntryCard`, `LastCaptureCard`; TrolleysPage slot pop-up'ı (istasyon seçici + MeasurementEditor); ProductsPage detay (istasyon bazında ölçümler + geçmiş). RoutesPage silindi.

### API Conventions
- Standard error envelope: `{ error: { code, message, details } }`. Codes: 400 VALIDATION_ERROR, 401 UNAUTHORIZED/TOKEN_EXPIRED, 403 FORBIDDEN, 404 NOT_FOUND, 409 DUPLICATE_NAME/WORK_ORDER_ACTIVE/INVALID_TRANSITION/RECIPE_IN_USE, 502 PLC_CONNECTION_FAILED/OPCUA_SESSION_FAILED/OPCUA_CERT_UNTRUSTED, 500 INTERNAL_ERROR.
- Route files per module (`*.routes.ts`) + service files (`*.service.ts`); routes registered under `/api/...` prefixes inside each module's `register()`.

## Frontend Patterns

### Structure
- `core/`: Layout (Sidebar+Header+Content), ThemeProvider (dark/light), LanguageProvider (TR/EN), ProtectedRoute, ErrorBoundary, common components; hooks (`useAuth`, `useWebSocket`, `useTheme`, `useLanguage`); services (`api.ts` fetch wrapper w/ error-envelope handling, `ws.ts` WS client w/ exponential-backoff reconnect 1s→30s + token refresh); Zustand stores (`authStore`, `appStore`); i18n (`locales/tr.json`, `en.json`); styles (`index.css`, `variables.css` CSS custom properties, `themes/dark.css`, `light.css`).
- `modules/`: feature folders per domain (`auth`, `dashboard`, `plc-gateway`, `recipe`, `work-order`, `user-management`, `system-settings`, `traceability`) with `components/`, `hooks/`, `services/` subfolders.

### Routing (`App.tsx`)
- Lazy-loaded pages via `React.lazy` + `Suspense`. Public: `/login`. Protected (ProtectedRoute → Layout): `/` DashboardPage (DashboardSelector), `/dashboard/:workOrderId` (DashboardView), `/plc`, `/plc/:id/tags`, `/plc/:id/monitor` (LiveMonitor), `/plc/read-write`, `/recipes`, `/recipes/:id/dashboard` (DashboardEditor), `/work-orders` (WorkOrderList), `/users` (UserList), `/settings` (SettingsPage), `/audit` (AuditLogViewer), `/trace/stations`, `/trace/work/:stationKey` (StationWorkPage), `/trace/products`, `/trace/trolleys`, `/trace/alarms`. `*` → Navigate to `/`.
- `useAuthRestore()` runs before routes to restore session.

### Traceability (frontend)
- `trace.service.ts` (API wrapper — tip bazlı tipler: StationType, StationConfig, Measurement, TriggerPayload). `QrCode.tsx` (SVG path render). `StationWorkPage`: **istasyon tipine göre özel panel** (qr_generate hero + QR geçmişi; PLC'li tiplerde LastCaptureCard + ManualEntryCard + TrolleyGrid + slot pop-up'ı). Ortak bileşenler: `TrolleyGrid` (4x5 slot ızgarası), `MeasurementEditor` (ölçüm ekle/düzenle/sil + önerilen alanlar), `QrLabelModal` (mm boyutlu etiket + yazdırma). `trace/styles/trace.css` (slot grid, panel kartları, measurement editör, qr-label).

### Dashboard (Faz 5)
- `useLiveValues(plcIds[])` hook: multi-PLC `subscribe:plc`, tagId→value map. `DashboardView`: view-only absolute-position grid (12 cols, rowHeight 72), renders recipe `dashboard_layout.widgets` live. `DashboardSelector`: active+paused WO cards, WS `workorder:changed` ile canlı tazelenir.
- Widget render components: Numeric/Gauge (custom SVG arc)/Trend (Recharts)/Status (LED)/Table. `dashboard/styles/dashboard.css` (`wv-*`).

### State & Data
- Zustand for auth + global app state (no boilerplate, TS-first).
- Server state fetched via `api.ts`; live values via `useWebSocket` + per-module hooks (e.g. `usePlcLiveData`) subscribing to `plc:data`.
- i18n via react-i18next; all user-facing strings in locale JSON files.

### Styling (2026-07-29 revizyonu)
- Plain CSS with CSS custom properties (`variables.css`), theme files under `styles/themes/`; per-module styles (e.g. `modules/recipe/styles/recipe.css`). No CSS framework.
- **Tasarım dili:** **amber accent (#fdc954 dark / #d99e1a light)**, cam yüzeyler (`--glass`, `backdrop-filter: blur`), yumuşak radius (xs 6px → xl 28px, keskin köşe yok), katmanlı gölgeler, motion (`--transition-fast/normal/slow`, keyframes: modal-in, modal-sheet-in, dropdown-in, toast-in/out, pulse-dot, fade-in-up). **Full-width layout** (boxed yok).
- **Ortak bileşenler (`core/components/common`):** Button (`small`/`btn-sm` varyantı), Input, Select, Card, **Modal (React Portal)**, ConfirmDialog, Table, Badge, **Alert** (ikonlu yumuşak şerit — tüm form/sayfa hata/bilgi mesajları bunu kullanır, badge-hack YOK), **Checkbox** (amber tik, animasyonlu), **ToastProvider + useToast** (WS `system:notification` → otomatik toast).
- **Modal = React Portal:** Tüm modallar `createPortal(..., document.body)` ile render edilir. Böylece ikincil diyalog (browse/picker) üst modalın `backdrop-filter` containing block'una hapsolMAZ — **tam sayfa overlay + blur** ile önceki modalın üzerinde açılır, önceki modal arka planda açık kalır (TagForm→NodeBrowserDialog, WidgetConfig→TagSelect aynı desen). `modalStack` → z-index `calc(var(--z-modal) + var(--z-modal-step))`.
- **Escape yığını:** modül-seviyesinde `modalCloseStack` — Escape yalnızca EN ÜSTTEKİ modalı kapatır; scroll-lock iç içe güvenli. İç içe pop-up deseni (browse/picker): NodeBrowserDialog, **TagSelect** (absolute dropdown YERİNE ikincil dialog).
- **Inline-style kuralı:** form/sayfa hata-bilgi şeritleri → `<Alert>`, onay kutuları → `<Checkbox>`, modal footer boşluğu → `<div className="spacer"/>`, tablo aksiyon butonları → `<Button small>`.
- **Layout:** mobil drawer sidebar (hamburger, `.sidebar-overlay`, ≤1023px — `mobile-open` class, `useIsMobile()` matchMedia hook ile JS↔CSS senkron), kullanıcı avatar dropdown (`.user-menu`, `.dropdown-menu`), WS nabız rozeti (`.status-dot-pulse`). Sidebar minimize: masaüstünde brand'de collapse, **en altta expand** (`.sidebar-bottom > .sidebar-expand-btn`); mobilde drawer'da X kapatma.
- **Responsive breakpoint'ler:** 1023px (drawer), 860px (dashboard paleti grid), 640px (modal → bottom-sheet, form satırları alt alta, toast altta). iOS: `100dvh`, `env(safe-area-inset-bottom)`.
- **Erişilebilirlik:** `focus-visible` halkaları (`--focus-ring`), `prefers-reduced-motion`, ARIA (dialog, menu, tree, aria-live toast bölgesi).


## Key Conventions
- **Comments and docs in Turkish** throughout the codebase; keep this convention.
- Backend uses ESM-style imports with `.js` suffix (TypeScript NodeNext resolution).
- Schema changes: new migration only, never edit existing.
- New backend module: create `modules/<name>/{index,routes,service}.ts` implementing `IModule`, then add to `registerAllModules()`.
