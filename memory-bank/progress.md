> Status snapshot: **2026-08-06**. Source of truth for scope: `implementation_plan.md` (v3).

## Phase Status

| Phase | Scope | Status |
|-------|-------|--------|
| Faz 1 | Temel Altyapı (core infra) | ✅ Complete |
| Faz 2 | PLC Gateway (Modbus + OPC UA) | ✅ Complete |
| Faz 3 | Reçete Yönetimi (recipes) | ✅ Complete |
| Faz 4 | İş Emri Yönetimi (work orders) | ✅ Complete |
| Faz 5 | Dashboard (widgets) | ✅ Complete |
| Faz 6 | Sistem Yönetimi (users/settings/archive/audit) | ✅ Complete |
| Faz 7 | PWA & Polish | 🔶 In progress |
| **Ürün İzlenebilirliği** | Product Traceability (QR + istasyon/rota) | ✅ Complete |

## What Works (Faz 1)
- [x] Monorepo structure (npm workspaces), backend Fastify+TS, frontend Vite+React+TS
- [x] SQLite connection (WAL) + versioned migrations (`schema_migrations`) + auto-backup + seed
- [x] CSS design system (variables, dark/light themes), Layout (Sidebar+Header+Content)
- [x] i18n TR/EN (react-i18next, locale JSONs)
- [x] Auth: login page, JWT + httpOnly cookie, bcryptjs, forced first-login password change (`must_change_password`)
- [x] Default admin seed (admin/admin)
- [x] Standard API error envelope + `/api/health`
- [x] Module system (registry + loader, DB-backed enable/disable)
- [x] Docker Compose + Dockerfile (single container, port 3000)

## What Works (Faz 2)
- [x] PLC profile CRUD (frontend+backend, protocol-dynamic forms) — modbus_tcp / modbus_rtu / opcua
- [x] Tag CRUD (protocol-aware address field; TEXT addresses)
- [x] WorkerManager + per-PLC Worker Threads (plc.worker)
- [x] Modbus TCP adapter, Modbus RTU adapter
- [x] OPC UA adapter (node-opcua): connection lifecycle, reconnect (exp backoff 1s→30s)
- [x] OPC UA subscription engine (MonitoredItem, publishing-interval groups, deadband) + poll fallback
- [x] OPC UA browse service + NodeBrowserDialog (node pick auto-fills address + data type)
- [x] Certificate trust management (TOFU): PKI dirs, auto self-signed client cert, trust/reject flow, CertificatesPanel, audit `trust_cert`
- [x] Credential encryption AES-256-GCM (`secret.service.ts`, `ENCRYPTION_KEY`)
- [x] Test Connection (all three protocols), online/offline/cert_pending status display
- [x] WebSocket live data streaming (`plc:data`, `plc:status`) + client reconnect
- [x] ReadWritePanel (manual read/write), LiveMonitor (live view without active WO)
- [x] Runtime PLC add/remove; auto-start of `is_active` PLCs on server boot

## What Works (Faz 3)
- [x] Backend recipe module (`recipe.routes.ts`, `recipe.service.ts`) registered in module system
- [x] Frontend: RecipeList, RecipeForm, TagSelect (tag mapping), DashboardEditor (react-grid-layout), recipe.service, recipe.css
- [x] Recipe protection rules: `DELETE` → 409 `RECIPE_IN_USE` when work orders exist (already present in `recipe.routes.ts`)
- [x] `PUT /api/recipes/:id/dashboard` layout persistence (validated `{ widgets: [...] }` schema; verified in DashboardEditor save flow)

## What Works (Faz 4 — İş Emri)
- [x] Backend `work-order` module: `work-order.service` (CRUD + `WO-YYYYMMDD-NNN` auto-number + `TRANSITIONS` state machine), `work-order.routes` (list/get/create/update-notes/delete + activate/pause/resume/complete/archive + `GET /:id/data`), `data-collector.service` (worker data → `data_log`, 1s transaction batching, quality/value_text, boot resume). Registered in `modules/index.ts` (dependencies: recipe, plc-gateway).
- [x] Transition guard: `canTransition` (draft→active→paused→completed→archived); invalid transitions → 409 `INVALID_TRANSITION`. Notes edit/delete only for draft (409 `WORK_ORDER_ACTIVE`).
- [x] DataCollector tag resolution: union of `recipe_tags` + `dashboard_layout` widget `tagId`/`tagIds`; only writes for `active`/`paused` WOs; `quality='bad'` → value NULL + quality 'bad'; STRING → `value_text`.
- [x] WS broadcast `workorder:changed` on transitions; audit entries for create/delete/transitions.
- [x] Frontend `work-order` module: `workOrder.service`, `WorkOrderList` (status filter, per-state action buttons, delete draft, dashboard link), `WorkOrderForm` (recipe select + notes). Route `/work-orders`.
- [x] Verified end-to-end: WO-20260730-001 created → activated (started_at set) → `data_log` rows written for widget-bound tags (tag 4,5,6, quality 'good').

## What Works (Faz 5 — Dashboard)
- [x] Widget render components: `NumericWidget`, `GaugeWidget` (custom SVG arc, no dep), `TrendWidget` (Recharts live line), `StatusWidget` (green/red LED), `TableWidget` (multi-tag values). Styles `dashboard/styles/dashboard.css` (`wv-*`).
- [x] `useLiveValues(plcIds[])` hook — multi-PLC subscription, tagId→value map.
- [x] `DashboardSelector` (home `/`): active+paused WO cards with WS live refresh (`workorder:changed`).
- [x] `DashboardView` (`/dashboard/:workOrderId`): view-only absolute-position grid (12 cols, rowHeight 72) rendering recipe widgets with live data; subscribes to PLCs of widget-bound tags.
- [x] `DashboardPage` router switch (selector vs view). Verified: Counter numeric + gauge widget live values render on active WO.

## What Works (Faz 6 — Sistem Yönetimi)
- [x] Backend `user-management`: `user.service` (bcrypt, last-admin guard, must_change_password on create/reset), `user.routes` (admin-only CRUD) + `permission.routes` (`/api/permissions` GET/PUT for role_permissions, module×permission).
- [x] Backend `system-settings`: `settings.service` (key-value get/set), `module.service` (enable/disable), `archive.service` (interlock on active WOs → `WORK_ORDER_ACTIVE`; full DB copy `mes_data_<ts>.db`; clears only `data_log`), `settings.routes` (`/api/settings`, `/api/modules`, `/api/archive` GET status + POST run, `/api/audit` paged query).
- [x] Frontend `admin.service` (users/permissions/settings/modules/archive/audit). Pages: `UserList` + `UserForm` + `PermissionEditor` (operator role module×permission checkbox matrix), `SettingsPage` (Branding + ModuleManager) + `ArchivePanel` (size + warn + interlock + confirm), `AuditLogViewer` (paged table, action badge variants). Routes `/users`, `/settings`, `/audit`.
- [x] Verified: permission matrix grid renders; archive blocked while 1 active WO (interlock); audit shows login/create/start/stop/delete entries.

## What Works (Ürün İzlenebilirliği — Migration 11+12, 2026-08-05/06)
- [x] **Migration 11 (`traceability_station_types`):** Yetenek+rota sistemi DROP; `trace_measurements` (UPSERT, plc/manual) + `trace_station_runtime` eklendi; eski istasyonlar eşlendi.
- [x] **Migration 12 (`drop_station_type`) [2026-08-06]:** `trace_stations` tablosu yeniden inşa edildi; `type` kolonu fiziksel olarak DROP edildi. DB şeması: `id, key, name, sort_order, is_active, config, created_at, updated_at`.
- [x] **2-tag PLC sözleşmesi [2026-08-06]:** `triggerTagId` (BOOL) + `statusTagId` (INT: 0=IDLE/1=BUSY/2=PASS/3=ERROR). Eski 5-tag (Ack/Busy/ErrorCode/ErrorMessage) sistemi kaldırıldı.
- [x] **station.type komple kaldırıldı [2026-08-06]:** DB, backend servis/routes/engine, frontend arayüz ve tip tanımlarından temizlendi. Dispatch mantığı `StationConfig` tag varlığına göre dinamik.
- [x] **Dispatch kuralları (config-based):** shellId+slot→Matching; shellId(no slot)→Funnel; trolleyId+row→Filling; trolleyId+data→Probing; trolleyId yalnız→TrolleyRead; `!config.plcId`→QR.
- [x] **İstasyon kartları [2026-08-06]:** StationsPage tabloydan kart grid'e dönüştürüldü. Add/Delete butonları kaldırıldı. Renk+ikon `station.key` alt dizisine göre belirleniyor.
- [x] **Bağımlılıksız QR encoder** (`traceability/qr/qrcode.ts`): ISO/IEC 18004, ECC M, Reed-Solomon → SVG. `QrCode.tsx` frontend render.
- [x] **Backend `traceability` modülü:** `trace.service`, `station.engine`, `trace.routes`, `plc-data-watcher.ts`, PLC bridge.
- [x] **Frontend traceability modülü:** StationsPage (kart grid), StationWorkPage (6 config-bazlı panel), ProductsPage, TrolleysPage, MeasurementEditor, TrolleyGrid, QrLabelModal, QrCode.
- [x] **Manuel tetikleme:** `POST /api/trace/stations/:key/trigger` — aynı handler'lar, PLC'ye yazılmaz.
- [x] **Ölçüm CRUD:** `GET/POST/PUT/DELETE /api/trace/measurements(/:id)` — düzenlenebilir/silinebilir/manuel eklenebilir.
- [x] **Doğrulama:** typecheck (backend ✅ + frontend ✅ temiz). Migration 12 canlı DB'de uygulandı. e2e 34/34 (OPC UA sim). Tarayıcıda kart görünümü + ayarlar pop-up doğrulandı.

## Not Started
- Faz 7: service worker (already via vite-plugin-pwa generateSW), offline cache strategy, manifest/icons (icon.svg present), add-to-homescreen, responsive polish, Docker optimization.

## What Works (Frontend UI Revizyonu — 2026-07-29, Faz 7'den erken)
- [x] Yeni tasarım dili: **amber accent (#fdc954 / light #d99e1a)**, cam yüzeyler (glass), yumuşak radius, katmanlı gölgeler, motion sistemi
- [x] Full-width layout (boxed kaldırıldı)
- [x] Sidebar minimize/maximize: `useIsMobile()` (JS↔CSS senkron 1023px), mobilde X kapatma, masaüstünde expand butonu sidebar altında
- [x] İç içe pop-up deseni: `Modal modalStack` prop (`--z-modal-step: 20`); TagSelect ikincil seçim diyaloğu olarak açılır (dropdown yerine)
- [x] `ToastProvider` + `useToast` hook — success/error/warning/info, otomatik kapanma, WS `system:notification` entegrasyonu
- [x] `ConfirmDialog` — yıkıcı işlemler için standart onay (PlcList, TagList, RecipeList)
- [x] Modal: Escape kapatma, scroll-lock, `wide` varyantı, mobilde bottom-sheet (≤640px)
- [x] Kullanıcı menüsü dropdown (avatar + rol + çıkış), dışarı tıkla/Escape kapanır
- [x] Mobil drawer sidebar: hamburger + blur overlay, ≤1023px; navigasyon sonrası otomatik kapanır
- [x] WS durum rozeti: nabız animasyonlu canlı nokta
- [x] CRUD geri bildirimleri toast'a bağlandı (PLC/Tag/Reçete silme+kaydetme, sertifika trust/reject, dashboard kaydetme)
- [x] Responsive: form satırları mobilde alt alta, dashboard paleti mobilde grid, tablolar yatay kaydırma, iOS safe-area
- [x] `prefers-reduced-motion` desteği; `focus-visible` halkaları (erişilebilirlik)
- [x] Typecheck temiz; tarayıcıda görsel doğrulama tamamlandı

## What Works (Kullanıcı Dostu Bileşen Turu — 2026-07-30)
- [x] Yeni ortak bileşenler: `Alert` (ikonlu yumuşak şerit, 4 varyant), `Checkbox` (amber tik, animasyonlu), `Button small` (`btn-sm`)
- [x] Inline-style temizliği: tüm `badge`-hack hata şeritleri → `<Alert>`, ham checkbox'lar → `<Checkbox>`, footer spacer → `.spacer` sınıfı
- [x] **Modal → React Portal:** ikincil diyaloglar artık tam sayfa overlay + blur ile önceki modalın üzerinde açılıyor ("pop-up içinde pop-up" düzeltildi — TagForm→NodeBrowserDialog deseni her yerde)
- [x] Escape yalnızca en üstteki modalı kapatır (global modal yığını); scroll-lock iç içe güvenli
- [x] Tarayıcıda doğrulandı: Widget config → Data Source (TagSelect) tam sayfa blur overlay; kapatınca widget config açık kalıyor. Typecheck + build temiz (PWA 22 girdi)

## Known Issues / Gaps

- **Faz 7 (PWA & Polish)** remaining: offline cache strategy tuning, add-to-homescreen prompt, responsive polish, Docker production optimization. (Service worker already generated by vite-plugin-pwa; `public/icons/icon.svg` present.)
- **Module enable/disable** via `/api/modules` requires a server restart to apply route changes (documented; `restartRequired: true` returned).
- **Operator `role_permissions`** are editable via `/api/permissions` but are **not yet enforced** in other modules' route handlers (they only gate `/api/users` & `/api/permissions` which are admin-only). Enforcement wiring is a future hardening task.
- `DashboardView` uses absolute-position grid at 12-col desktop scale; small screens don't yet reflow widgets (Faz 7 responsive polish).

## Evolution Log
- **2026-07-29:** Memory Bank initialized. Assessed: Faz 1–2 done, Faz 3 in progress (recipe module + dashboard editor present; protection rules + e2e verification remaining).
- **2026-07-29 (gece):** Frontend UI revizyonu (Faz 7'den erken) — amber design language, glass, motion, Toast/ConfirmDialog, mobil drawer, React Portal modal deseni, Alert/Checkbox/btn-sm.
- **2026-07-30:** **Faz 3 tamamlandı** (recipe protection rules confirmed + dashboard save verified), **Faz 4 tamamlandı** (work-order module + DataCollector + frontend list/form), **Faz 5 tamamlandı** (5 widget render components + useLiveValues + DashboardSelector/View), **Faz 6 tamamlandı** (user-management + system-settings modules: users/permissions/settings/modules/archive/audit). End-to-end verified in browser + API (WO activate → data_log rows; dashboard live widgets; permission matrix; archive interlock; audit entries). Backend+frontend typecheck & production build clean (PWA 35 precache entries).
- **2026-07-30 (Ürün İzlenebilirliği):** Migration 3–7 (traceability schema), QR encoder, traceability modülü, frontend (StationsPage/WorkPage/ProductsPage/TrolleysPage/RoutesPage), OPC UA sim uçtan uca testler.
- **2026-08-01–02:** İstasyon turu #2–#12 — trolley_read, plc_acquire, clearOnRead, StationForm sadeleştirme, TagMultiSelect, Funnel Sıkma + Trolley Yükleme bölünmesi (Migration 9), OPC UA trigger handshake, QR akışı, ürün/araba silme.
- **2026-08-04:** MES Bridge iptal + kaldırıldı (Migration 10). PLC = OPC UA Server, MES = OPC UA Client mimarisi. OK/Hata kontratı (ackTagId/errorTagId/errorMessageTagId).
- **2026-08-05:** **İzlenebilirlik v2 büyük yeniden yapı** — yetenek+rota sistemi kaldırıldı; sabit istasyon tipleri + standart PLC sözleşmesi + ölçüm CRUD. Migration 11. e2e 34/34. Typecheck + build temiz.
- **2026-08-06:** **station.type KOMPLE KALDIRILDI.** Migration 12 (type kolonu DROP). Trigger+Status(INT) 2-tag sistemi. StationsPage kart grid. Dispatch config-bazlı. Backend+Frontend typecheck ✅ temiz.

## Verification Commands
```bash
npm run typecheck                              # both packages
npm test --workspace=packages/backend          # backend tests
node scripts/opcua-sim.mjs [--secure|--auth u:p]
node scripts/modbus-sim.mjs
node scripts/recipe-api-test.mjs
node scripts/trace-e2e-test.mjs               # 34/34 traceability e2e
```
