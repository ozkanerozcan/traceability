# Active Context — OE MES

## Current Focus
**Faz 1–6 + Ürün İzlenebilirliği TAMAMLANDI** (2026-07-30). Tüm çekirdek modüller (plc-gateway, recipe, work-order, user-management, system-settings, **traceability**) backend + frontend olarak devrede ve uçtan uca doğrulandı. Repo: https://github.com/ozkanerozcan/traceability (origin/main güncel). Son büyük özellik: **Product Traceability** (QR üretimi + capability bazlı istasyon/rota motoru). Kalan: Faz 7 (PWA & Polish).

## What Exists Right Now

### Backend (`packages/backend/src/`)
- `core/`: database (connection/migrations/seed), auth (plugin/routes/service), crypto (secret.service), websocket (ws.manager/ws.types), module-system (interface/registry/loader), audit (audit.service).
- `modules/index.ts` registers: **plc-gateway**, **recipe**.
- `modules/plc-gateway/`: index, plc.routes/service, tag.routes/service, opcua.routes, plc.types, `adapters/` (opcua.adapter, certificate.manager, value-codec, index), `workers/` (plc.worker, worker.manager).
- `modules/recipe/`: index, recipe.routes, recipe.service.

### Frontend (`packages/frontend/src/`)
- `core/`: Layout, ThemeProvider, LanguageProvider, ProtectedRoute, common components; hooks (useAuth, useWebSocket, useTheme, useLanguage); services (api, ws); stores (authStore, appStore); i18n (tr.json, en.json); styles (index, variables, themes).
- `modules/auth/LoginPage.tsx`
- `modules/dashboard/DashboardPage.tsx` (placeholder-ish; widget system is Faz 5)
- `modules/plc-gateway/`: PlcList, PlcForm, TagList, TagForm, LiveMonitor, ReadWritePanel, NodeBrowserDialog, CertificatesPanel, usePlcLiveData hook, plc.service
- `modules/recipe/`: RecipeList, RecipeForm, TagSelect, DashboardEditor components; services/recipe.service; styles/recipe.css

### Routes (App.tsx)
`/login` (public) → protected: `/`, `/dashboard/:workOrderId`, `/plc`, `/plc/:id/tags`, `/plc/:id/monitor`, `/plc/read-write`, `/recipes`, `/recipes/:id/dashboard`.

## Next Steps (from implementation_plan.md)
1. **Finish Faz 3:** recipe protection rules (silme/düzenleme engeli — prevent delete/edit of recipes in use), verify DashboardEditor + TagSelect end-to-end, `PUT /api/recipes/:id/dashboard` layout persistence.
2. **Faz 4 (İş Emri):** work-order backend module + frontend pages, auto order number `WO-YYYYMMDD-NNN`, state machine (draft→active→paused→completed→archived), DataCollector service with transaction batching, role-based authorization.
3. **Faz 5 (Dashboard):** widget system + palette + config popup, Numeric/Gauge/Trend/Status/Table widgets, live WS updates, active-WO switching, recipe preview mode.
4. **Faz 6:** user management, permissions, settings, module manager, branding, archive, audit viewer.
5. **Faz 7:** PWA, offline cache, responsive polish, Docker optimization.

## Active Decisions & Conventions
- Code comments/docs in **Turkish**; keep it consistent.
- DB schema changes: **new migration only**, never edit existing ones; auto-backup runs before migrate.
- PLC tag addresses are TEXT: Modbus `40001` absolute; OPC UA NodeId `ns=2;s=...`.
- OPC UA acquisition is **subscription-first**, poll fallback.
- Widgets arrive **empty** on the canvas; configuration happens via popup/sidebar (v2 decision).
- Dashboard in work-order view is **view-only** for operators; template editing only in Recipe screen.
- Standard API error envelope `{ error: { code, message, details } }` everywhere.
- Session: httpOnly cookie (web + PWA); WS auth via `?token=` query param.

## Testing Aids
- `node scripts/opcua-sim.mjs` (basic) / `--secure` / `--auth test:test123` — full OPC UA scenario testing without real hardware (see implementation_plan.md → Doğrulama Planı for 8 step-by-step scenarios).
- `node scripts/modbus-sim.mjs` — Modbus TCP sim on :5020.
- `node scripts/recipe-api-test.mjs` — recipe API test.
- `node scripts/ws-test.mjs` / `ws-watch.mjs` — WS verification.

## Session Notes
- **2026-07-29:** Memory Bank initialized (this file set). No code changes made. Project state assessed from `implementation_plan.md` (v3) and source tree: Faz 1–2 complete, Faz 3 in progress.
- **2026-07-29 (gece):** Frontend UI revizyonu (Faz 7'den erken): modern tasarım dili — teal accent, cam (glassmorphism) yüzeyler, yumuşak radius (keskin köşe yok), motion (modal/dropdown/toast/sheet animasyonları). Yeni ortak bileşenler: `ToastProvider`+`useToast` (WS `system:notification` → otomatik toast), `ConfirmDialog`, erişilebilir `Modal` (Escape, scroll-lock, `wide` varyantı), kullanıcı avatar dropdown'u, mobil drawer sidebar (hamburger + overlay, ≤1023px), mobilde modal → bottom-sheet. Toast'lar CRUD geri bildirimlerine bağlandı (PLC/Tag/Recipe list + formlar + DashboardEditor + CertificatesPanel). Breakpoint'ler: 1023px (drawer), 860px (dashboard editör paleti), 640px (bottom-sheet, form satırları, toast alt). `prefers-reduced-motion` destekleniyor. i18n: `sidebar.*`, `ws.*` anahtarları eklendi (tr/en). Typecheck temiz; tarayıcıda login, drawer, PLC listesi, PLC form modal, ConfirmDialog, user dropdown, DashboardEditor (mobil palet), widget config modal, TagSelect dropdown doğrulandı.
- **2026-07-29 (gece, kullanıcı geri bildirimleri):**
  - **Accent:** teal (#2dd4bf) → **amber (#fdc954)** (dark), #d99e1a (light). Tema dosyaları + tüm rgba referansları (brand-mark, user-avatar, login-logo-mark, arka plan desenleri, focus-ring) güncellendi.
  - **Layout:** boxed (max-width 1560px) kaldırıldı → **full-width** `.app-content`.
  - **Sidebar minimize/maximize revizyonu:** `useIsMobile()` hook (matchMedia 1023px, JS↔CSS senkron). Mobilde drawer'da X kapatma butonu; masaüstünde collapse butonu brand'de, **expand butonu sidebar'ın EN ALTINDA** (`.sidebar-bottom` + `.sidebar-expand-btn`, bordered 40px). Daraltılmışta: brand yalnız logo (metin gizli), footer gizli, link etiketleri `.sidebar-link-label` ile gizlenir. Mobil↔masaüstü geçişinde drawer otomatik kapanır.
  - **İç içe pop-up deseni (browse/picker):** `Modal`'a **`modalStack` prop** (z-index `--z-modal` + `--z-modal-step: 20`). Kullanıcı bu deseni sevdi — **TagSelect artık absolute dropdown DEĞİL**, ana pop-up üzerinde açılan ikincil seçim diyaloğu (NodeBrowserDialog ile aynı desen). Yeni stiller: `.tag-picker-search`, `.tag-picker-list`.
  - i18n: `sidebar.close` eklendi (tr/en).
  - Üretim build alındı (`vite build` + `copy-frontend.mjs`) — PWA precache 22 girdi.
- **2026-07-30:** Kullanıcı dostu bileşen turu + iç içe pop-up revizyonu:
  - **Yeni ortak bileşenler:** `Alert` (success/warning/danger/info, ikonlu, yumuşak şerit — tüm form/sayfa hata-bilgi mesajları badge-hack'inden taşındı), `Checkbox` (amber tik, animasyonlu, tema uyumlu — PlcForm/TagForm/DashboardEditor ham `<input type=checkbox>`'lardan taşındı), `Button small` (`btn-sm`, tablo aksiyonları — CertificatesPanel).
  - **Inline-style temizliği:** modal footer `<div style={{flex:1}}/>` → `.spacer` sınıfı (PlcForm, CertificatesPanel); `alert alert-*` kalıpları → `<Alert>` (LoginPage, PlcForm, TagForm, RecipeForm, RecipeList, DashboardEditor, LiveMonitor, CertificatesPanel); recipe.css'teki eski `.alert` kuralları kaldırıldı (artık index.css'te ortak).
  - **Modal → React Portal (kullanıcı geri bildirimi):** ikincil diyaloglar (TagSelect gibi) üst modalın `backdrop-filter` containing block'una hapsolup "pop-up içinde pop-up" görünüyordu. `Modal` artık `createPortal(..., document.body)` ile render ediliyor — ikincil diyalog TAM SAYFA overlay + blur ile önceki modalın üzerinde açılıyor, önceki modal arka planda açık kalıyor (TagForm → NodeBrowserDialog deseniyle birebir aynı). `modalStack` z-index basamağı korunuyor.
  - **Escape yığını:** global `modalCloseStack` — Escape yalnızca EN ÜSTTEKİ modalı kapatır; alttaki diyalog açık kalır. Scroll-lock iç içe güvenli (önceki overflow geri yüklenir).
- Tarayıcıda doğrulandı: DashboardEditor → widget config → Data Source (TagSelect) tam sayfa blur overlay ile açılıyor; kapatınca widget config açık kalıyor. Typecheck + üretim build temiz (PWA precache 22 girdi).
- **2026-07-30 (Faz 4+5+6):** İş Emri, Dashboard ve Sistem Yönetimi tamamlandı ve uçtan uca doğrulandı.
  - **Faz 4:** Backend `work-order` modülü (CRUD + `WO-YYYYMMDD-NNN` + `TRANSITIONS` durum makinesi + `canTransition`), `data-collector.service` (worker→`data_log`, 1sn transaction batching, quality/value_text, recipe_tags ∪ dashboard widget tagId/tagIds, boot resume). Frontend `WorkOrderList` (durum filtresi + durum bazlı aksiyonlar) + `WorkOrderForm`. Route `/work-orders`.
  - **Faz 5:** 5 widget render bileşeni (Numeric, Gauge custom-SVG, Trend Recharts, Status LED, Table), `useLiveValues(plcIds[])` hook, `DashboardSelector` (aktif WO kartları, WS canlı), `DashboardView` (view-only 12-col absolute grid, canlı veri). `/` ve `/dashboard/:workOrderId`.
  - **Faz 6:** Backend `user-management` (user CRUD bcrypt + last-admin guard + `/api/permissions` module×permission) + `system-settings` (settings, modules enable/disable→restartRequired, archive interlock+full-copy+yalnız data_log, audit paged). Frontend: UserList+UserForm+PermissionEditor (checkbox matrisi), SettingsPage (Branding+ModuleManager)+ArchivePanel, AuditLogViewer. Rotalar `/users`, `/settings`, `/audit`.
  - **Doğrulama (tarayıcı + API):** WO-20260730-001 oluşturuldu → activate (started_at) → `data_log`'a widget-bound tag kayıtları (tag 4,5,6, quality 'good') düştü; canlı dashboard Counter numeric + gauge render oldu; yetki matrisi ızgara doğru; arşivleme 1 aktif WO varken engellendi (interlock); audit login/create/start/stop/delete gösterdi. Typecheck + backend/frontend build temiz (PWA 35 precache).
  - Commit `d22a52f` (+`934b7d3` chore) → origin/main push edildi.
- **2026-07-30 (Ürün İzlenebilirliği):** `product_traceability.md` gereksinimleri uygulandı.
  - **Migration 3 (`traceability_schema`):** 11 tablo + 9 ön-tanımlı istasyon (QR Generator, Trolley Assignment, Filling, Probing, Conditioning, Drilling, X-Ray, Painting, Manual Workstation) + varsayılan rota + `modules` kaydı.
  - **Bağımlılıksız QR encoder** (`traceability/qr/qrcode.ts`): ISO/IEC 18004, byte mode, ECC M, sürüm 1–10, Reed-Solomon (GF256) → SVG path. Native bağımlılık yok. `QrCode.tsx` render bileşeni.
  - **Backend `traceability` modülü:** `trace.service` (CRUD + `SH-YYYYMMDD-NNNN`), `station.engine` (capability motoru + task management — zorunlu görevler tamamlanmadan ilerleme yok), `trace.routes` (`/api/trace/*`), PLC bridge (`workerManager.readTag`/`writeTag`).
  - **Rota/task:** ürün bazlı istasyonlarda rota dışı → 409 `ROUTE_VIOLATION`; NOK → `rejected` + alarm; conditioning erken çıkış → alarm + PLC'ye alarm yaz + reddet. Filling=groupSize'lı grup, Probing=tüm arabaya yay.
  - **Frontend:** StationsPage (CRUD + capability toggle + PLC config), StationWorkPage (capability'e göre dinamik UI — tarama odaklı), ProductsPage (detay + QR etiket/yazdır), TrolleysPage (20 slot), RoutesPage (adım siralama), AlarmsPanel (ack). Rotalar `/trace/*`, sidebar nav.
  - **Doğrulama:** QR üretimi (SH-20260730-0001 + taranabilir SVG), trolley atama (advanced:true), rota ihlali 409 (fresh product→drilling reddedildi), typecheck + backend/frontend build temiz (PWA 43 precache). Commit `6fdb751` (+`488c66c` chore) → origin/main push edildi.



