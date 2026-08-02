# Active Context — OE MES

## Current Focus
**Faz 1–6 + Ürün İzlenebilirliği TAMAMLANDI** (2026-07-30). Tüm çekirdek modüller (plc-gateway, recipe, work-order, user-management, system-settings, **traceability**) backend + frontend olarak devrede ve uçtan uca doğrulandı. Repo: https://github.com/ozkanerozcan/traceability (origin/main güncel). İstasyon bazlı inceleme turu sürüyor — **#1 QR üretim istasyonu** (mm boyutlu etiket önizleme + yazdırma + önceki QR'lar) ve **#2 yetenek modeli yeniden tasarımı** (printing kaldırıldı, trolley_assign→**trolley_read**, plc_acquire **trigger bitli** olay-bazlı, her yetenek ayrı kartta) tamamlandı. **#3 Araba Atama derinleştirme** de tamamlandı: araba okutunca **otomatik içerik temizleme** (slot_count korunur), canlı **shell slot ızgarası**, TrolleysPage'de **kalıcı slot_count** düzenleme, trigger **subscribe-only** + **handshake** (kayıt sonrası trigger'ı false çek), `lastCapture` gösterimi. **#4 PLC Read genellemesi** de tamamlandı (istasyondan bağımsız PLC Read: trigger subscribe + çoklu değişken → Shell ID'ye kayıt; senaryolar: scan/plc/trolley [satır-bazlı 4'lü veya tüm-ürünler]; `clearOnRead` yalnız ilk istasyonda). **#5 StationForm sadeleştirme** de tamamlandı (ana form: isim + yetenek çipleri; anahtar isimden otomatik, tip yeteneklerden otomatik; yetenek seçimi ayrı pop-up, yetenek konfigürasyonu ayrı iç içe pop-up). Kalan: Faz 7 (PWA & Polish) + diğer istasyonların gözden geçirilmesi.

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
2. **Faz 4 (İş Emri):** work-order backend module + frontend pages, auto order number `WO-YYYYMMDD-NNN`, state machine (draft→active→paused→completed→archived), DataCollector service with transaction batching, role-based authorization.a
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
- **2026-07-30 (İstasyon inceleme turu #1 — QR üretim istasyonu):** Operatör "QR Üret" dediğinde mm boyutlu etiket önizleme pop-up'ı + yazdırma + önceki QR'lar listesi eklendi.
  - **Backend:** `StationConfig`'e `labelWidth`/`labelHeight` (mm) eklendi (config JSON — migration gerekmedi). Yeni endpoint `GET /api/trace/qr-history?limit=24` → son ürünleri `{ productId, qrContent, svgPath, size, status, createdAt }` olarak döndürür (svgPath backend'de `qrToSvgPath` ile). `trace.service.listQrHistory()`.
  - **Frontend:** Yeni `QrLabelModal.tsx` — etiketi **gerçek mm boyutunda** (CSS `mm` birimi) render eder (QR + altında içerik metni); **Yazdır** butonu dinamik `@page { size: Wmm Hmm; margin:0 }` enjekte edip `window.print()` yapar, kapanınca kaldırır. `QrCode.tsx`'e `sizeMm` prop'u (viewBox ile kayıpsız ölçek). `StationWorkPage`: QR istasyonunda "QR Üret" → modal önizleme (inline card yerine); altta **"Önceki QR Kodlar"** ızgarası (thumbnail + ID + tarih), tıklayınca yeniden yazdırma için aynı modal. `StationsPage` formuna `qr_generate` seçiliyken **Etiket Genişlik/Yükseklik (mm)** inputları (varsayılan 50×30). `ProductsPage` de `QrLabelModal`'e taşındı (eski `.trace-qr-label` kaldırıldı).
  - **CSS/i18n:** `trace.css`'e `.trace-qr-print` (mm boyutlu), `.trace-qr-history` ızgarası, güncel `@media print` (yalnız etiket). i18n `trace.labelSize/labelWidth/labelHeight/qrHistory/noQrHistory/reprint` (tr/en).
  - **Doğrulama:** typecheck + backend/frontend build temiz (PWA 43 precache). Not: çalışma ağacında önceki oturumlardan kalma commit'lenmemiş UI değişiklikleri (ErrorBoundary, index.css, App.tsx, LoginPage vb.) de vardı — hepsi birlikte push'landı. Commit `caa8b2e` → origin/main.
- **2026-08-01 (İstasyon inceleme turu #2 — yetenek modeli yeniden tasarımı):** Kullanıcı geri bildirimiyle istasyon yetenek modeli yenilendi.
  - **printing kaldırıldı** (qr_generate yazdırmayı zaten içerir). **trolley_assign → trolley_read (Araba Okuma):** istasyon sayfasında araba Trolley ID + Onayla ile **sabit** onaylanır (localStorage + backend aktif bağlam); okutulan her ürün bu arabaya işlenir (slot otomatik = sonraki boş, ya da plc_acquire slotTagId'sinden). **plc_acquire (PLC Data) yeniden:** config'de **ürüne yazılacak çoklu tag (dataTagIds) + 1 trigger biti (triggerTagId) + opsiyonel slot tagi (slotTagId)** seçilir; **olay-bazlı izleyici** trigger bitini canlı akışta (`workerManager.onData`) izler, **false→true kenarında** data tag'leri PLC'den okuyup istasyonun AKTİF ürününe yazar (`capturePlcData`), slot varsa arabaya atar, ilerletir, aktif ürünü temizler. **Her yetenek istasyon sayfasında ayrı kartta** gösterilir.
  - **Backend:** `trace.service` (capability tipi + `dataTagIds/triggerTagId/slotTagId` + **aktif bağlam** `getStationContext/setActiveTrolley/setActiveProduct/clearActiveProduct` + `getTrolley/nextFreeSlot`); **Migration 4** (`traceability_capability_rename` — mevcut istasyonların capabilities JSON'unda trolley_assign→trolley_read, printing silindi); `station.engine` (handleTrolleyRead, handlePlcAcquireScan=ürünü AKTİF yapar, `capturePlcData` export, tryAdvance plc_acquire için 'done' kaydı şartı); **yeni `plc-data-watcher.ts`** (onData kenar izleyici, `startPlcDataWatcher`/`reloadPlcDataWatches`); routes `POST /stations/:key/trolley` (onay) + `GET /stations/:key/context`; index.ts watcher'ı register'da başlatır (v1.1.0).
  - **Frontend:** `trace.service` (CAPABILITY_KEYS güncel + `confirmTrolley`/`getStationContext` + `TrolleyContext` tipi); `StationWorkPage` **yetenek başına ayrı kart** (QR/Araba Okuma/PLC Data/Parti/OK-NOK/Bekleme), araba onayı localStorage'da sabit + 3sn'de bağlam tazeleme; `StationsPage` formu (printing kaldırıldı, plc_acquire için PLC + trigger + slot + **çoklu data tag checkbox** `trace-tag-picker`); i18n (tr/en) `trace.cap.trolley_read` + confirmTrolley/changeTrolley/triggerTag/slotTag/dataTags/plcDataConfig/waitingPlc/processProduct/setActiveProduct vb.
  - **Doğrulama:** Migration 4 gerçek DB'de uygulandı (capabilities doğru); API ile trolley_read akışı (onay→context→tara→oto slot+ilerleme); **OPC UA sim ile uçtan uca trigger testi** (`scripts/trace-trigger-test.mjs` — 12/12: sim PLC kur → probing trigger config → ürün AKTİF → Sim.Bool toggle → veri ürüne yazıldı + ilerledi). **Kritik bulgu:** opcua-sim `getOwnNamespace()` kullandığı için değişkenler **ns=1**'de (kod yorumundaki ns=2 yanlış) — test tag adresleri `ns=1;s=...` olmalı. Tarayıcıda doğrulandı: yetenekler ayrı kartlarda, araba onayı sabit (TR-001 4/20→5/20), ürün oto slot. Typecheck + build temiz (PWA 42 precache). Not: `DEFAULT_DB_PATH='./data/mes.db'` cwd'ye göre çözümlenir — sunucu `packages/backend`'den başlatılmalı (yoksa stray `mes/data/mes.db` oluşur).




- **2026-08-01 (İstasyon inceleme turu #3 — Araba Atama derinleştirme):** Kullanıcı geri bildirimiyle trolley_assign istasyonu derinleştirildi.
  - **Araba okutunca OTOMATİK içerik temizleme:** İlk istasyon + arabalar tekrar kullanıldığından, `POST /stations/:key/trolley` onayında `releaseTrolley` ile önceki slot içeriği OTOMATİK temizlenir (**slot_count KORUNUR** — kalıcı kolon). Reset butonu YOK.
  - **Canlı shell slot ızgarası:** trolley_read kartında onaylı arabanın slot yerleşim ızgarası (`.trace-slot-grid`/`.trace-slot`) — PLC verisi geldikçe 3 sn context poll ile **canlı dolar**.
  - **Kalıcı slot_count düzenleme:** `PUT /api/trace/trolleys/:id` (`updateTrolleySlotCount`) + TrolleysPage'de kapasite düzenleme modalı — sıfırlamada/otomatik temizlemede silinmez.
  - **PLC Data trigger subscribe-only:** StationsPage formunda trigger biti dropdown'u yalnızca `acquisitionMode==='subscribe'` tag'leri listeler (anında algılama) + `triggerSubscribeHint`. Slot tagi + çoklu data tag (torque/shell id/...) ayrı seçilir.
  - **Handshake:** `capturePlcData` kaydettikten sonra trigger tag'i **false** yazar (`writePlcValue`) → PLC "okuma bitti" anlar, yeniden trigger edebilir; watcher false bildiriminde re-arm. Aktif ürün yoksa alarm + yine ack (hat tıkanmaz).
  - **`lastCapture` gösterimi:** StationContext'e `lastCapture` (ürün + data + slot + zaman); `GET /stations/:key/context` döndürür; PLC Data kartında "Son Yakalanan Veri" (`.trace-last-capture`). "Set Active Product" yalnızca trolley_read'siz istasyonlarda.
  - **Backend:** `updateTrolleySlotCount`, `setLastCapture`, `LastCapture` tipi; routes `PUT /trolleys/:id` + context `lastCapture`; trolley confirm'de `releaseTrolley`.
  - **Doğrulama:** `scripts/trace-handshake-test.mjs` OPC UA sim ile **17/17** — araba onayında içerik oto temizlendi; QR üret → ürün AKTİF; Setpoint=1 (trigger) → counter+slot ürüne yazıldı + arabaya slot atandı + **Setpoint otomatik 0 (handshake)** + lastCapture bağlamda. Tarayıcıda slot ızgarası (20 slot) doğrulandı. Typecheck + build temiz (PWA 42).

- **2026-08-01 (İstasyon inceleme turu #4 — PLC Read genellemesi):** Kullanıcı geri bildirimiyle PLC Read istasyondan bağımsız genel bir yapıya dönüştürüldü.
  - **Genel PLC Read:** trigger biti (yalnız **subscribe** tag — anında algılama) + PLC'den okunacak **çoklu değişken** (`dataTagIds`). Trigger TRUE olunca değişkenler okunup Shell ID(ler)e kaydedilir; ardından trigger **false** çekilir (handshake).
  - **Shell ID kaynağı (`StationConfig.shellIdSource`):** `'scan'` (taranan AKTİF ürün — varsayılan, eski handshake korunur), `'plc'` (Shell ID `shellIdTagId`'den okunur), `'trolley'` (onaylı arabadaki ürünler — `trolleyMatchMode:'row'` + `rowTagId` satır no + `rowSize`=4 satır-bazlı, veya `'all'` tüm ürünler).
  - **`clearOnRead` bayrağı:** araba okutunca otomatik içerik temizleme **yalnız ilk/yükleme istasyonunda** (varsayılan true); sonraki istasyonlar yüklü arabayı okurken `false` (ürünler silinmez). StationsPage'de checkbox. (Önceki sürümde her onayda temizliyordu — düzeltildi.)
  - **Backend:** `capturePlcData` rework (3 kaynak → hedef ürün(ler) → veri oku → yaz + ilerlet → handshake); `trace.service` StationConfig genişletmesi; trolley confirm'de `clearOnRead` kontrolü.
  - **Frontend:** StationsPage PLC Read config UI (PLC + trigger subscribe + Shell ID kaynağı + koşullu alanlar scan/plc/trolley + çoklu data tag); StationWorkPage'de trolley_read görünürlüğü (okuma alanı ↔ detay+slot ızgarası) + "Set Active Product" yalnız 'scan' modunda + kaynak bazlı config özeti. i18n `shellIdSource/shellIdTag/trolleyMatch/rowTag/rowSize/src.*/match.*/clearOnRead`.
  - **Doğrulama:** `scripts/trace-scenarios-test.mjs` **12/12** (4 ürün arabaya yüklendi → rowtest clearOnRead=false **temizlemedi** → row=0 trigger → **satırdaki 4 ürüne temp** + handshake). Scan regresyonu `trace-handshake-test.mjs` **17/17**. Sim'e yazılabilir `Sim.RowNum` eklendi. Typecheck + build temiz (PWA 42).

- **2026-08-01 (İstasyon inceleme turu #5 — StationForm sadeleştirme):** Kullanıcı geri bildirimiyle istasyon ekleme/düzenleme pop-up'ı sadeleştirildi ("karışık görünüyor" şikayeti).
  - **Sade ana form:** yalnızca **İsim + atanan yetenek çipleri** (`.trace-cap-chip`). Karışık inline konfigürasyon (PLC Read, wait, label, clearOnRead) formdan çıkarıldı.
  - **Anahtar OTOMATİK:** `slugify(name)` — isimden URL-güvenli anahtar (çalışma sayfası rotası için gerekli ama elle girilmez; düzenlemede mevcut key korunur). Kullanıcının "anahtar gerekli mi?" sorusuna: gerekli ama otomatik üretiliyor.
  - **Tip OTOMATİK:** `deriveType(caps)` — yeteneklerden türetilir (qr/trolley/plc/wait/check/assembly/generic). Manuel tip seçimi formdan kaldırıldı. Kullanıcının "tip gerekli mi?" sorusuna: gerekli değil, otomatik.
  - **Yetenek seçimi ayrı pop-up:** `CapabilityPicker` (çoklu checkbox, `modalStack` iç içe pop-up). Ana formdaki "+ Yetenek Ekle" ile açılır.
  - **Yetenek konfigürasyonu ayrı pop-up:** `CapabilityConfig` — konfigürasyon gerektiren yetenekler (qr_generate/trolley_read/plc_acquire/wait_control/batch_assign) çipteki dişli (⚙) ikonuyla kendi iç içe pop-up'ında ayarlanır. Tek `config: StationConfig` objesi state'inde; `set(key, value)` helper.
  - **Doğrulama (tarayıcı):** isim→anahtar oto (test_dolum), yetenek seçici (blur overlay), PLC Verisi çipi + tip oto "PLC", "PLC Verisi Ayarları" pop-up'ı (PLC + Trigger subscribe + Shell ID kaynağı + slot). Typecheck + build temiz (PWA 42). i18n `stationNamePlaceholder/autoDerived/addCapability/selectCapabilities/configureCapability*/noCapabilities/componentKind/kind.*`; CSS `.trace-cap-chips/-chip/-chip-btn/-add`.

- **2026-08-02 (İstasyon inceleme turu #6 — PLC Data yapılandırma revizyonu):**
  - **`slotTagId` kaldırıldı:** Ayrı "Slot Tag" dropdown'ı kaldırıldı — slot/pozisyon bilgisi artık `dataTagIds` içinde yer alır. Frontend + backend tiplerinden, `station.engine`'den ve UI'dan kaldırıldı.
  - **Multi-select `TagMultiSelect` bileşeni (yeni):** `dataTagIds` için arama destekli pop-up — tag adı/adres/açıklama ile filtreleme, çoklu seçim (toggle), seçilenleri liste halinde gösterim. Checkbox listesi yerine kullanılıyor.
  - **Select bileşeni düzeltmeleri:** `.map()` sonucu gelen çocuk ögeler recursive işlendi; boş değer placeholder "Seçiniz..." eklendi. Trigger bit `subscribe + BOOL` ile filtrelendi.

- **2026-08-02 (İstasyon inceleme turu #7 — İç İçe Modal Z-Index Sıralaması Düzeltmesi):**
  - **Pop-up tekrar açılmama sorunu çözüldü:** `StationForm` -> `CapabilityConfig` -> `Select` (Shell ID Kaynağı) iç içe pop-up hiyerarşisinde seçim yapıldıktan sonra üst modal re-render oluyordu. Eski z-index mantığı static `modalCloseStack.length` okuduğu için, re-render sonrasında parent modal `CapabilityConfig` bir üst z-index basamağına çıkıyor ve ikincil `Select` modalı tekrar açıldığında parent modalın altında kalıyordu.
  - **Dinamik Modal Yığını Yöneticisi (`globalModalStack`):** Her `Modal` bileşenine benzersiz `Symbol` atandı ve global yığında kayıtlı tutulup listener sistemiyle dinlendi. Açık kalan modal'ların z-index seviyeleri yığındaki gerçek sıra numaralarına (`depth`) göre dinamik olarak güncelleniyor. Seçim yapılıp üst modal re-render olduğunda parent modal kendi sırasını korur, yeni açılan `Select` pop-up'ı her zaman 1 basamak yüksekte (en üstte) pürüzsüzce açılır.

- **2026-08-02 (İstasyon inceleme turu #8 — Shell ID Kaynağı Seçenekleri Revizyonu):**
  - **Taranan (`scan`) kaldırıldı:** PLC Veri Ayarları (`plc_acquire`) konfigürasyonundaki Shell ID Kaynağı seçeneğinden `Taranan Ürün` tamamen çıkarıldı. Varsayılan kaynak `PLC - Shell ID` olarak ayarlandı.
  - **Seçenek Etiketleri Güncellendi:** `PLC'den` ➔ **`PLC - Shell ID`**, `Arabadan` ➔ **`PLC - Trolley ID`**.

- **2026-08-02 (İstasyon inceleme turu #9 — Trolley 4x5 Düzeni, Trolley ID Tag ve Genel Ayarlar Taşınması):**
  - **Trolley ID Tag (`trolleyIdTagId`) eklendi:** `PLC - Trolley ID` kaynağında Trolley ID verisinin hangi PLC tag'inden okunacağı pop-up ayarlarında seçilebilir hale getirildi. Backend'de PLC'den okunan Trolley ID koduna göre araba otomatik eşleştirilir.
  - **Satır Başına Ürün ve Araba Kapasitesi Genel Ayarlara Taşındı:** `Ayarlar` (`SettingsPage.tsx`) sayfasına **"Üretim & İzlenebilirlik"** kartı eklendi: **Araba Ürün Kapasitesi** (`trolley_capacity`, varsayılan 20) ve **Satır Başına Ürün** (`row_size`, varsayılan 4) proje geneli ayarlar olarak kaydedildi.
  - **Trolley Izgara Görünümü 4x5 Yapıldı:** `.trace-slot-grid` CSS `grid-template-columns: repeat(4, 1fr)` olarak güncellendi (4 sütun x 5 satır = 20 slot).

- **2026-08-02 (İstasyon inceleme turu #10 — Araba Değiştir Temizleme Düzeltmesi):**
  - **Araba Değiştir sorunu çözüldü:** Operatör "Araba Değiştir" butonuna tıkladığında frontend/localStorage temizleniyordu ancak backend aktif araba hafızası silinmediği için 3 sn polling eski arabayı geri getiriyordu. `DELETE /api/trace/stations/:key/trolley` ve `clearActiveTrolley` ile hem frontend hem backend sıfırlaması sağlandı.

- **2026-08-02 (İstasyon inceleme turu #11 — Araba Okuma Kartı Sadeleştirmesi):**
  - **Araba Okuma (`trolley_read`) Kartı Sadeleştirildi:** Araba Okuma kartından gereksiz `Ürün ID` tarama alanı kaldırıldı; kart yalnızca araba onayı ve canlı 4x5 slot ızgarası gösterimine indirgendi.

- **2026-08-02 (İstasyon inceleme turu #12 — 1-Tabanlı Satır Numarası Eşleştirmesi):**
  - **Satır Numarası Eşleştirmesi:** PLC'den okunan `rowTagId` satır numarası için 1-tabanlı eşleştirme uygulandı (`1. satır = 1..4 slotlar`, `2. satır = 5..8 slotlar`).

- **2026-08-02 (PLC Management — Tag Silme FOREIGN KEY Hatası Düzeltmesi):**
  - **Migration 5 (`recipe_tags_cascade_delete`):** `recipe_tags` tablosu `tag_id REFERENCES plc_tags(id) ON DELETE CASCADE` yapıldı; `deleteTag` ve `deletePlc` servislerinde transaction temizliği sağlandı.

- **2026-08-02 (PLC Management — Tag Formunda Subscribe Modu Örnekleme Sıklığı Etiketi):**
  - **Dinamik Etiket:** [TagForm.tsx](file:///c:/Users/ozkanerozcan/Desktop/Traceability/mes/packages/frontend/src/modules/plc-gateway/components/TagForm.tsx#L227) formunda `pollingIntervalMs` etiketi `acquisitionMode` seçimine göre dinamik yapıldı (`Poll` ➔ `Polling (ms)`, `Subscribe` ➔ `Örnekleme Sıklığı (ms)`).

- **2026-08-02 (PLC Management — OPC UA Browse String Veri Tipi Algılama İyileştirmesi):**
  - **Çok Aşamalı Veri Tipi Tespiti (`readDataTypeAttribute`):** Standart tipi, NodeId regex, BrowseName/DisplayName sorgusu ve canlı `Value` attribute okuması fallback'i eklendi. Siemens S7 dahil tüm `STRING`/`WString` tag'ler gözatma ekranında otomatik `STRING` algılanıyor.

- **2026-08-02 (PLC Verisi Ayarları — TagMultiSelect Seçim Sayısı Uyuşmazlığı Düzeltmesi):**
  - **Düzeltme:** `TagMultiSelect` ([TagMultiSelect.tsx](file:///c:/Users/ozkanerozcan/Desktop/Traceability/mes/packages/frontend/src/modules/traceability/components/TagMultiSelect.tsx#L36)) bileşeninde `validSelectedIds` süzgeci uygulandı. Mükerrer ve silinmiş tag ID'leri süzülerek sayacın ve pop-up butonlarının kart sayısı ile %100 birebir eşitlenmesi sağlandı.

- **2026-08-02 (Ürün Yönetimi — Ürün Silme Özelliği):**
  - **Ürün Silme Özelliği Eklendi:** Ürünler sayfasında (`ProductsPage.tsx`) listelenen ürünlerin yönetimi için silme mekanizması kuruldu.
  - **Backend Endpoint (`DELETE /api/trace/products/:id`):** `deleteProduct` ([trace.service.ts](file:///c:/Users/ozkanerozcan/Desktop/Traceability/mes/packages/backend/src/modules/traceability/trace.service.ts#L341)) fonksiyonu ile ürün silindiğinde, ürüne ait araba slot kayıtları (`trace_trolley_slots`), istasyon geçmiş kayıtları (`trace_station_records`) ve alarmlar (`trace_alarms`) tek bir transaction içerisinde güvenle temizlenir. Audit kaydı (`trace_product` delete) atılır.
  - **Frontend Entegrasyonu:** [ProductsPage.tsx](file:///c:/Users/ozkanerozcan/Desktop/Traceability/mes/packages/frontend/src/modules/traceability/components/ProductsPage.tsx#L106) tablosuna silme butonu (`Trash2` ikonu) ve `ConfirmDialog` onay diyaloğu eklendi.
  - **Değişen Dosyalar:** `ProductsPage.tsx`, `trace.service.ts` (fe/be), `trace.routes.ts`, `tr.json`, `en.json`.

- **2026-08-02 (Araba Yönetimi — Araba Silme Özelliği):**
  - **Araba Silme Özelliği Eklendi:** Arabalar sayfasında (`TrolleysPage.tsx`) tanımlı arabaların yönetimi ve silinmesi sağlandı.
  - **Backend Endpoint (`DELETE /api/trace/trolleys/:id`):** `deleteTrolley` ([trace.service.ts](file:///c:/Users/ozkanerozcan/Desktop/Traceability/mes/packages/backend/src/modules/traceability/trace.service.ts#L254)) fonksiyonu ile araba silindiğinde, arabaya ait slot yerleşimleri (`trace_trolley_slots`), alarmlar (`trace_alarms`) ve aktif istasyon çalışma bağlamları (`stationContexts`) temizlenir. Audit kaydı (`trace_trolley` delete) atılır.
  - **Frontend Entegrasyonu:** [TrolleysPage.tsx](file:///c:/Users/ozkanerozcan/Desktop/Traceability/mes/packages/frontend/src/modules/traceability/components/TrolleysPage.tsx#L90) kart aksiyonlarına silme butonu (`Trash2` ikonu) ve `ConfirmDialog` onay diyaloğu eklendi.
  - **Değişen Dosyalar:** `TrolleysPage.tsx`, `trace.service.ts` (fe/be), `trace.routes.ts`, `tr.json`, `en.json`.

- **2026-08-02 (Ürünler Sayfası — Hızlı Ürün Ekleme & QR Etiket Pop-up Entegrasyonu):**
  - **Hızlı Ürün Ekleme Butonu:** Ürünler sayfasına (`ProductsPage.tsx`) Arabalar sayfasındaki gibi **"+ Ürün Ekle"** butonu eklendi.
  - **QR Üretim İstasyonuyla Birebir Aynı İşlev:** Butona tıklandığında backend `createNewProduct` ([station.engine.ts](file:///c:/Users/ozkanerozcan/Desktop/Traceability/mes/packages/backend/src/modules/traceability/station.engine.ts#L570)) fonksiyonu çağrılarak otomatik benzersiz `SH-YYYYMMDD-NNNN` ürün kimliği üretilir, QR etiketi render edilir ve QR istasyonu kaydı atılır.
  - **Otomatik Pop-up Önizleme:** Oluşturma tamamlandığında üretilen ürünün **gerçek mm boyutlu QR Etiket pop-up'ı (`QrLabelModal`)** ekranda otomatik açılır. Operatör ürünler sayfasından çıkmadan hızlıca etiket önizleyebilir ve doğrudan yazdırabilir.
  - **Değişen Dosyalar:** `ProductsPage.tsx`, `station.engine.ts`, `trace.service.ts` (fe/be), `trace.routes.ts`, `tr.json`, `en.json`.

- **2026-08-02 (İstasyon Çalışma Ekranı — Son Yakalanan Veri & Özeti Filtreleme):**
  - **Düzeltme:** Silinmiş tag artıkları (`#5`) hem `Son Yakalanan Veri` bileşeninde hem de kart üstündeki **"Ürüne Yazılacak Tag'ler" özet alanında** (`StationWorkPage.tsx`) aktif `plcTags` listesiyle süzüldü. Artık silinmiş tag ID'leri arayüzdeki özet metinlerinde de gösterilmiyor.
  - **Değişen Dosyalar:** `StationWorkPage.tsx`.

- **2026-08-02 (Çeviri Anahtarları & Geçmiş PLC Verisi Okuma Düzeltmesi):**
  - **i18n Çevirileri:** `tr.json` ve `en.json` dosyalarına eksik olan `trace.activeTrolley`, `trace.plcDataTitle`, `trace.stationHistoryTitle`, `trace.timestamp` ve `trace.confirmTrolleyFirst` çeviri anahtarları eklendi.
  - **Geçmiş PLC Verisi Ayrıştırma:** Backend `getTrolleyProductItems` fonksiyonunda (`trace.service.ts`) veritabanındaki `data` sütunu yanlışlıkla `data_json` olarak okunduğu için tork vb. önceden kaydedilmiş PLC verilerinin `null` dönmesi sorunu çözüldü. Ayrıca frontend `StationWorkPage.tsx` üzerinde pop-up açıldığında geçmiş PLC verilerinin filtrelenmeden eksiksiz gösterilmesi sağlandı.
  - **Değişen Dosyalar:** `trace.service.ts` (backend), `StationWorkPage.tsx`, `tr.json`, `en.json`.

- **2026-08-02 (Veritabanı Şeması Görselleştirme & Dokümantasyon):**
  - **Dokümantasyon Artifact'ı:** Projenin veritabanı mimarisi, 23 tablonun detayları, alan tipleri ve tablolar arası ilişkileri Mermaid ER Diyagramı ile `database_schema_documentation.md` olarak dokümante edildi. Proje kaynak kodunda hiçbir değişiklik yapılmadı.
  - **Shell ID Ürün Kayıtları Rehberi:** Kullanıcının sorusu üzerine belirli bir Shell ID (`product_id`) ile ürün kayıtlarını getirmek için REST API (`GET /api/traceability/products/:productId`), veritabanı SQL birleştirme sorguları ve backend servis metodları (`getProductByProductId`, `getProductRecords`) kullanım kılavuzu sağlandı.

- **2026-08-02 (Nihai 2-Tablolu Sade Mimarisi — `trolleys` & `shells`):**
  - **Fiziksel Tablo Yapısı:** Migration 6 ile veritabanı `trolleys` (`trolley_id`, `capacity`) ve `shells` (`shell_id`, `trolley_id`, `slot_number`, `status`, `history`) fiziki tablolarına geçirildi.
  - **Veri Tekrarı Temizliği:** `plc_data` kolonu kaldırılarak tüm PLC ölçümleri ve istasyon onayları tekil `history` JSON dizisinde birleştirildi. `trace.service.ts` metodları güncellendi.
  - **Değişen Dosyalar:** `migrations.ts`, `trace.service.ts`, `walkthrough.md`.

- **2026-08-02 (QR Kod Üretim İstasyonu Akış İyileştirmesi & Özel Shell ID Desteği):**
  - **Araba Zorunluluğu Kaldırıldı:** QR Kod Üretim (`qr_generate`) istasyonunda araba (`trolley_id`) sorma zorunluluğu kaldırıldı.
  - **Düzenlenebilir Öneri & Pop-up:** "QR Kod Üret" butonuna tıklandığında backend `generateProductId()` ile önerilen Shell ID alınır, pop-up'ta gösterilir. Kullanıcı önerilen kodu kullanabilir veya kendi özel Shell ID'sini yazabilir.
  - **Unique Kontrolü & Yazdırma:** "Oluştur & Yazdır" butonunda Shell ID benzersizliği doğrulanır (duplicate engel) ve anında yazdırılabilir `QrLabelModal` etiketi açılır.
  - **Değişen Dosyalar:** `StationWorkPage.tsx`, `station.engine.ts`, `trace.routes.ts`, `trace.service.ts` (fe), `tr.json`, `en.json`.

- **2026-08-02 (Veritabanı Migrasyonu Düzeltmesi — Migration 7):**
  - **Kök Neden:** Mevcut veritabanı dosyalarında Migration 6 daha önceden uygulandığı için `shells` tablosu üzerinde `route_id` sütunu bulunmayan eski bir VIEW kalmıştı. Bu durum `no such column: route_id` hatasına yol açıyordu.
  - **Çözüm:** Migration 7 (`traceability_shells_trolleys_tables`) eklendi. SQLite üzerinde bir nesnenin tablo mu yoksa görünüm (view) mü olduğu `sqlite_master` üzerinden dinamik olarak kontrol edilerek `dropObject` fonksiyonuyla güvenle silindi ve `route_id` içeren fiziki tablolar oluşturuldu.
  - **Değişen Dosyalar:** `migrations.ts`.

- **2026-08-02 (QR Kod Üretim İstasyonu Full-Width Tasarım Revizyonu):**
  - **Full-Width Düzen:** QR Kod Üretim istasyonu kutulu (boxed) yapıdan çıkarılıp tam sayfa genişliğine (`width: 100%`) kavuşturuldu.
  - **Hero Buton & Kart Mimarisi:** "QR KOD ÜRET" aksiyon butonu büyütüldü ve parlak amber gradyanı eklendi. Önceki QR kodların kart tasarımı durum rozeti, üretim saati ve geniş QR önizleme alanı ile yenilendi.
  - **Değişen Dosyalar:** `StationWorkPage.tsx`, `trace.css`, `walkthrough.md`.

- **2026-08-02 (Önceki QR Kodlar Kartında Etiket Görünümü Eşitlemesi):**
  - **Düzeltme:** "Önceki QR Kodlar" kartlarının içinde yer alan QR ve Shell ID görünümü, yazdırma pop-up'ındaki (`QrLabelModal`) etiket görünümü (`trace-qr-print`) ile birebir aynı etiket konteynerini kullanacak şekilde güncellendi.
  - **Değişen Dosyalar:** `StationWorkPage.tsx`, `QrLabelModal.tsx`, `trace.css`.

- **2026-08-02 (Slot Detay Pop-up'ı — Mükerrer PLC Verisi Düzeltmesi):**
  - **Sorun:** Slot #1 Detayları pop-up'ında "PLC'den Okunan Canlı Veriler" bölümünde aynı tag (örn. Robot Funnel Screw Torque) iki kez görünüyordu. Kök neden: `capturePlcData`'da idempotency yoktu — trigger handshake tamamlanmadan yeniden yükselince aynı ürüne aynı istasyonda ikinci bir `done` kaydı yazılıyordu (SH-20260802-0001'de 2 adet `Araba Atama/done` kaydı).
  - **Backend düzeltmesi (`station.engine.ts`):** `capturePlcData`'ya yeniden tetik koruması eklendi — hedef ürün bu istasyonda zaten `done` kaydına sahipse veri yazılmaz (mükerrer kayıt atlanır), yalnızca handshake gönderilir ve uyarı loglanır. `hasRecord(productId, stationId, 'done')` filtresi ile.
  - **Frontend düzeltmesi (`StationWorkPage.tsx`):** Pop-up'taki PLC veri listesi artık tag başına TEK kart gösterir — aynı `tag_*` anahtarı için birden fazla kayıt varsa en güncel (son) kayıt esas alınır (`Map` ile dedupe).
  - **Veri temizliği:** SH-20260802-0001 history'sindeki mükerrer kayıt silindi (2 → 1 kayıt).
  - **Doğrulama:** typecheck + backend/frontend build temiz (PWA 42 precache). DB'de artık tek `done` kaydı.
  - **Değişen Dosyalar:** `station.engine.ts`, `StationWorkPage.tsx`.










