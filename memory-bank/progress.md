# Progress — OE MES

> Status snapshot: **2026-07-30**. Source of truth for scope: `implementation_plan.md` (v3).

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

## What Works (Ürün İzlenebilirliği — 2026-07-30)
- [x] **Migration 3 (`traceability_schema`):** 11 tablo (trace_stations, trace_routes, trace_route_steps, trace_trolleys, trace_products, trace_trolley_slots, trace_station_records, trace_batches, trace_alarms, trace_qr_logs + indeksler) + `modules` kaydı + 9 ön-tanımlı istasyon (QR Generator, Trolley Assignment, Filling, Probing, Conditioning, Drilling, X-Ray, Painting, Manual Workstation) + varsayılan rota.
- [x] **Bağımlılıksız QR encoder** (`traceability/qr/qrcode.ts`): ISO/IEC 18004, byte mode, ECC M, sürüm 1–10, Reed-Solomon (GF256). SVG path üretir — native bağımlılık YOK, air-gapped uyumlu. `QrCode.tsx` frontend render bileşeni.
- [x] **Backend `traceability` modülü:** `trace.service` (CRUD + `SH-YYYYMMDD-NNNN` product id + slot/record/batch/alarm), `station.engine` (capability motoru: qr_generate / trolley_assign / plc_acquire / ok_nok / batch_assign / wait_control / route_validate + **task management** — zorunlu görevler tamamlanmadan ilerleme yok), `trace.routes` (`/api/trace/*`), PLC bridge (`workerManager.readTag`/`writeTag`).
- [x] **Rota doğrulama:** ürün bazlı istasyonlarda rota dışı deneme → 409 `ROUTE_VIOLATION` (doğrulandı: fresh product → drilling reddedildi). NOK → ürün `rejected` + alarm. Bekleme (conditioning) erken çıkışta alarm + PLC'ye alarm yaz + reddet.
- [x] **Frontend `traceability` modülü:** StationsPage (CRUD + capability toggle + PLC/tag config), StationWorkPage (capability'e göre dinamik UI — tarama odaklı), ProductsPage (durum filtresi + detay + QR etiket/yazdır), TrolleysPage (20 slot görünümü), RoutesPage (adım sıralama + istasyon seçimi), AlarmsPanel (aktif alarmlar + ack). Rotalar `/trace/*`, sidebar nav linkleri.
- [x] **Doğrulama (API + tarayıcı):** 9 istasyon seed; QR üretimi (SH-20260730-0001 + taranabilir SVG); trolley atama (advanced:true, step ilerledi); rota ihlali 409; typecheck + backend/frontend build temiz (PWA 43 precache).
- [x] i18n `trace.*` + `nav.trace*` (tr/en); audit `trace_*` entity tipleri; WS `system:notification` (trace).

## What Works (İstasyon inceleme turu #1 — QR üretim istasyonu, 2026-07-30)
- [x] **Etiket boyut config:** `StationConfig.labelWidth/labelHeight` (mm) — StationsPage formunda `qr_generate` seçiliyken Genişlik/Yükseklik (mm) inputları (varsayılan 50×30). Config JSON olduğu için migration gerekmedi.
- [x] **`QrLabelModal` (yeni):** etiketi **gerçek mm boyutunda** (CSS `mm`) önizleyen pop-up — QR + altında içerik metni. **Yazdır** → dinamik `@page { size: Wmm Hmm; margin:0 }` + `window.print()`; kapanınca `@page` kaldırılır. `QrCode.sizeMm` prop'u (viewBox kayıpsız ölçek).
- [x] **QR üretim akışı:** StationWorkPage'de "QR Üret" → modal önizleme (inline card yerine). Altta **"Önceki QR Kodlar"** ızgarası (thumbnail + ID + tarih) — tıklayınca yeniden yazdırma için aynı modal; her üretimde tazelenir.
- [x] **Backend `GET /api/trace/qr-history?limit=24`:** son ürünleri `{ productId, qrContent, svgPath, size, status, createdAt }` döndürür (`trace.service.listQrHistory`). Frontend `traceService.getQrHistory()`.
- [x] **ProductsPage** de `QrLabelModal`'e taşındı (eski `.trace-qr-label` CSS'i kaldırıldı). `trace.css`'e `.trace-qr-print` + `.trace-qr-history` + güncel `@media print`.
- [x] i18n `trace.labelSize/labelWidth/labelHeight/qrHistory/noQrHistory/reprint` (tr/en). Typecheck + build temiz (PWA 43 precache).

## What Works (İstasyon inceleme turu #2 — yetenek modeli yeniden tasarımı, 2026-08-01)
- [x] **printing kaldırıldı** (qr_generate yazdırmayı içerir). **Migration 4 (`traceability_capability_rename`):** mevcut istasyonların capabilities JSON'unda trolley_assign→trolley_read, printing silindi (gerçek DB'de doğrulandı).
- [x] **trolley_read (Araba Okuma):** istasyon sayfasında Trolley ID + Onayla → **sabit araba** (localStorage + backend aktif bağlam `setActiveTrolley`). Okutulan her ürün arabaya işlenir — trigger'sızsa **sonraki boş slota otomatik** (`nextFreeSlot`), trigger'lıysa plc_acquire slotTagId'sinden. `POST /stations/:key/trolley` (onay) + `GET /stations/:key/context`.
- [x] **plc_acquire (PLC Data) trigger modeli:** config'de çoklu `dataTagIds` + `triggerTagId` + opsiyonel `slotTagId`. **Olay-bazlı izleyici** (`plc-data-watcher.ts`): trigger bitini `workerManager.onData` akışında izler, **false→true kenarında** `capturePlcData` → data tag'ler PLC'den okunup AKTİF ürüne yazılır, slot atanır, ilerler, aktif ürün temizlenir. Aktif bağlam bellek-içi (`getStationContext/setActiveProduct/clearActiveProduct`).
- [x] **Her yetenek ayrı kartta** (StationWorkPage): QR/Araba Okuma/PLC Data/Parti/OK-NOK/Bekleme. PLC Data kartı trigger+data tag özetini ve "PLC verisi bekleniyor" durumunu gösterir (3sn bağlam tazeleme).
- [x] **StationsPage formu:** printing kaldırıldı; plc_acquire için PLC + trigger biti + slot tagi + **çoklu data tag checkbox** (`.trace-tag-picker`). i18n tr/en (`cap.trolley_read`, confirmTrolley, changeTrolley, triggerTag, slotTag, dataTags, plcDataConfig, waitingPlc, processProduct, setActiveProduct vb.).
- [x] **Doğrulama:** API ile trolley_read uçtan uca (onay→context→tara→oto slot+ilerleme); **OPC UA sim ile trigger testi** `scripts/trace-trigger-test.mjs` **12/12** (sim PLC → trigger config → AKTİF ürün → Sim.Bool toggle → veri yazıldı + ilerleme). Tarayıcıda ayrı kartlar + sabit araba doğrulandı. Typecheck + build temiz (PWA 42). **Not:** opcua-sim değişkenleri **ns=1**'de (kod yorumundaki ns=2 yanlış).

## What Works (İstasyon inceleme turu #3 — Araba Atama derinleştirme, 2026-08-01)
- [x] **Araba okutunca OTOMATİK içerik temizleme:** `POST /stations/:key/trolley` onayında `releaseTrolley` ile önceki slot içeriği temizlenir (**slot_count KORUNUR**). Reset butonu YOK — ilk/yükleme istasyonu davranışı.
- [x] **Canlı shell slot ızgarası:** trolley_read kartında onaylı arabanın slot yerleşim ızgarası (`.trace-slot-grid`/`.trace-slot`) — 3 sn context poll ile canlı dolar.
- [x] **Kalıcı slot_count:** `PUT /api/trace/trolleys/:id` (`updateTrolleySlotCount`) + TrolleysPage kapasite düzenleme modalı.
- [x] **PLC Data trigger subscribe-only + handshake:** StationsPage trigger dropdown yalnız subscribe tag'ler; `capturePlcData` kayıt sonrası trigger'ı **false** yazar (`writePlcValue`) → PLC okuma bitti anlar, yeniden trigger edebilir. **`lastCapture`** gösterimi (PLC Data kartı).
- [x] **Doğrulama:** `scripts/trace-handshake-test.mjs` **17/17** (araba oto temizleme, QR→AKTİF, trigger→veri+slot, **Setpoint oto 0 handshake**, lastCapture). Tarayıcıda slot ızgarası. Typecheck + build temiz.

## What Works (İstasyon inceleme turu #4 — PLC Read genellemesi, 2026-08-01)
- [x] **PLC Read genel yapı (istasyondan bağımsız):** trigger biti (subscribe) + PLC'den okunacak çoklu değişken (dataTagIds) → trigger TRUE olunca okunan veriler Shell ID(ler)e kaydedilir. `StationConfig.shellIdSource` ile 3 senaryo:
  - **'scan'** (varsayılan): taranan AKTİF ürün (barkod) — mevcut handshake davranışı korunur.
  - **'plc':** Shell ID doğrudan PLC tag'inden okunur (`shellIdTagId`).
  - **'trolley':** onaylı arabadaki Shell ID'ler — **satır-bazlı** (`trolleyMatchMode:'row'`, `rowTagId` satır no, `rowSize`=4) veya **tüm ürünler** (`'all'`).
- [x] **`clearOnRead` bayrağı:** otomatik temizleme yalnız ilk/yükleme istasyonunda (varsayılan true) — sonraki istasyonlar yüklü arabayı okurken `false`'a çekilir (ürünler silinmez). StationsPage'de checkbox.
- [x] **StationsPage PLC Read config UI:** PLC + trigger (subscribe-only) + Shell ID kaynağı dropdown + koşullu alanlar (scan→slotTagId, plc→shellIdTagId, trolley→match+rowTagId+rowSize) + çoklu data tag. StationWorkPage'de "Set Active Product" yalnız 'scan' modunda + config özeti kaynağa göre.
- [x] **capturePlcData rework:** 3 kaynağa göre hedef ürün(ler) belirle → veri tag'lerini oku → yaz + ilerlet → handshake. Sim'e yazılabilir `Sim.RowNum` eklendi (satır testi için).
- [x] **Doğrulama:** `scripts/trace-scenarios-test.mjs` **12/12** (4 ürün arabaya yüklendi → rowtest clearOnRead=false **temizlemedi** → row=0 trigger → **satırdaki 4 ürüne temp yazıldı** + handshake). Scan modu regresyonu `trace-handshake-test.mjs` **17/17**. Typecheck + build temiz (PWA 42).

## What Works (İstasyon inceleme turu #5 — StationForm sadeleştirme, 2026-08-01)
- [x] **Sade ana form:** StationForm artık yalnızca **İsim + atanan yetenek çipleri** içeriyor — karışık inline konfigürasyon kaldırıldı.
- [x] **Anahtar otomatik:** `slugify(name)` ile isimden URL-güvenli anahtar üretilir (çalışma sayfası rotası için gerekli ama elle girilmez; düzenlemede mevcut key korunur). **Tip otomatik:** `deriveType(caps)` — yeteneklerden türetilir (qr/trolley/plc/wait/check/assembly), formdan manuel seçim kaldırıldı. (Kullanıcının "anahtar/tip gerekli mi?" sorularına yanıt: anahtar gerekli ama otomatik, tip gerekli değil/otomatik.)
- [x] **Yetenek seçimi ayrı pop-up:** `CapabilityPicker` (çoklu checkbox, `modalStack` iç içe pop-up deseni).
- [x] **Yetenek konfigürasyonu ayrı pop-up:** `CapabilityConfig` — her konfigürasyon-gerektiren yeteneğin (qr_generate/trolley_read/plc_acquire/wait_control/batch_assign) ayarları kendi iç içe pop-up'ında (`modalStack`). Çipteki dişli (⚙) ikonuyla açılır; tek `config` objesi state'inde düzenlenir.
- [x] **Doğrulama (tarayıcı):** isim → anahtar oto (`test_dolum`), yetenek seçici pop-up (blur overlay), PLC Verisi çipi + tip oto "PLC", PLC Verisi Ayarları pop-up'ı (PLC + Trigger + Shell ID kaynağı + slot). Typecheck + build temiz (PWA 42). CSS `.trace-cap-chips/-chip/-add`.

## What Works (İstasyon inceleme turu #6 — PLC Data yapılandırma revizyonu, 2026-08-02)
- [x] **`slotTagId` kaldırıldı:** Ayrı "Slot Tag" dropdown'ı kaldırıldı — slot/pozisyon bilgisi artık `dataTagIds` içinde yer alır ve trigger'da otomatik kaydedilir. Scan modunda aktif araba varsa ürün **sonraki boş slota** otomatik atanır (PLC'den gelen slot numarasına göre değil). Frontend + backend tiplerinden, `station.engine`'den ve UI'dan kaldırıldı.
- [x] **Multi-select `TagMultiSelect` bileşeni (yeni):** `dataTagIds` için arama destekli pop-up — tag adı/adres/açıklama ile filtreleme, çoklu seçim (toggle), seçilenleri **liste halinde** gösterim (tag adı + adres + birim + veri tipi, X ile kaldırma, scroll). Checkbox listesi yerine kullanılıyor.
- [x] **Select dizi (array) işleme hatası düzeltildi:** `processChild` `.map()` sonucu gelen children'ları işleyemiyordu — PLC/tag dropdown'ları hep boş gösteriyordu. Recursive dizi desteği eklendi.
- [x] **Modal `onClose` kararlılık sorunu düzeltildi:** `useRef` ile `onClose` referansı sabit tutuldu — `useEffect` yalnızca `open` değişince çalışır. Pop-up'ların tekrar açılmama sorunu çözüldü. `stableOnCloseRef` ile cleanup güvenliği eklendi.
- [x] **Placeholder seçenekler kaldırıldı:** "PLC seçin", "Tag yok" gibi bilgilendirme metinleri artık seçilebilir seçenek değil — PLC varken sadece PLC'ler, tag varken sadece tag'ler listeleniyor. PLC yokken disabled bilgi metni gösteriliyor.
- [x] **Trigger bit BOOL filtresi:** Sadece `subscribe + BOOL` tag'ler listeleniyor (önceki: sadece subscribe).
- [x] **Layout alt alta:** PLC, Trigger Bit, Shell ID Source yan yana değil, alt alta — daha ferah arayüz.
- [x] **Select boş değer placeholder:** Seçim yapılmadığında ilk seçeneğe düşmek yerine "Seçiniz..." gösteriliyor.
- [x] **Modal z-index & yığın yönetimi (`globalModalStack`):** Her `Modal` bileşenine benzersiz `Symbol` atandı ve global yığında sıra numarasına (`depth`) göre dinamik z-index verilerek iç içe pop-up re-render sorunları tam çözüldü (#7).
- [x] **Shell ID kaynağı sadeleştirme:** `Taranan` (`scan`) seçeneği kaldırıldı; etiketler `PLC - Shell ID` ve `PLC - Trolley ID` olarak güncellendi (#8).
- [x] **Trolley 4x5 ızgara düzeni & Trolley ID Tag:** `.trace-slot-grid` CSS `repeat(4, 1fr)` (4 sütun x 5 satır = 20 slot) yapıldı; `PLC - Trolley ID` seçeneğine `trolleyIdTagId` tag seçimi eklendi (#9).
- [x] **Genel Ayarlar taşınması:** Araba Kapasitesi (`trolley_capacity`, varsayılan 20) ve Satır Başına Ürün (`row_size`, varsayılan 4) `Ayarlar` (`SettingsPage.tsx`) sayfasına taşındı, pop-up'lardaki gereksiz girdiler temizlendi (#9).
- [x] **Araba Değiştir sıfırlama mekanizması:** `DELETE /api/trace/stations/:key/trolley` endpoint'i ve `clearActiveTrolley` fonksiyonu ile backend aktif araba hafızası sıfırlandı; 3sn polling çakışması çözüldü (#10).
- [x] **Araba Okuma Kartı Sadeleştirmesi:** Araba Okuma (`trolley_read`) kartından gereksiz `Ürün ID` tarama alanı kaldırıldı; kart yalnızca araba onayı ve canlı 4x5 slot ızgarasına odaklandı (#11).
- [x] **1-Tabanlı Satır Numarası Eşleştirmesi:** PLC `rowTagId` satır eşleştirmesi 1-tabanlı (`1. satır = 1..4 slotlar`, `2. satır = 5..8 slotlar`) yapıldı (#12).
- [x] **Tag Silme FOREIGN KEY Düzeltmesi:** Migration 5 (`recipe_tags_cascade_delete`) ile `recipe_tags` tablosunda `tag_id` sütununa `ON DELETE CASCADE` eklendi; `deleteTag` ve `deletePlc` transaction ile korundu (#13).
- [x] **Tag Formu Dinamik Etiketleme:** `TagForm.tsx` formunda `pollingIntervalMs` etiketi `acquisitionMode` seçimine göre dinamikleştirildi (`Poll` ➔ `Polling (ms)`, `Subscribe` ➔ `Örnekleme Sıklığı (ms)`) (#14).
- [x] **OPC UA Browse String Veri Tipi Algılama:** `readDataTypeAttribute` 4 aşamalı veri tipi algılama ile güncellendi; Siemens S7 dahil tüm `STRING`/`WString` tag'ler otomatik algılanıyor (#15).
- [x] **TagMultiSelect Sayaç Eşitlemesi:** `TagMultiSelect.tsx` bileşeninde `validSelectedIds` süzgeci ile mükerrer ve silinmiş tag ID'leri süzülerek sayaç ve buton sayıları kart sayısı ile eşitlendi (#15).
- [x] **Ürün Silme & Yönetimi:** Ürünler sayfasında (`ProductsPage.tsx`) ürün silme mekanizması kuruldu; `DELETE /api/trace/products/:id` endpoint'i ile ürün silindiğinde ilgili araba slotları, istasyon geçmiş kayıtları ve alarmlar transaction seviyesinde güvenle temizleniyor. Ortak `ConfirmDialog` diyaloğu entegre edildi.
- [x] **Araba Silme & Yönetimi:** Arabalar sayfasında (`TrolleysPage.tsx`) araba silme mekanizması kuruldu; `DELETE /api/trace/trolleys/:id` endpoint'i ile araba silindiğinde ilgili slot kayıtları, alarmlar ve aktif istasyon hafızaları temizleniyor. Ortak `ConfirmDialog` diyaloğu entegre edildi.
- [x] **Hızlı Ürün Ekleme & QR Yazdırma:** Ürünler sayfasına (`ProductsPage.tsx`) **"+ Ürün Ekle"** butonu eklendi. QR Üretim İstasyonu ile birebir aynı motor (`createNewProduct`) kullanılarak ürün üretilip anında gerçek mm boyutlu `QrLabelModal` yazdırma pop-up'ı otomatik açılıyor.
- [x] **Çeviri ve Geçmiş PLC Verisi Düzeltmeleri:** `tr.json` ve `en.json` içine eksik `activeTrolley`, `plcDataTitle`, `stationHistoryTitle` ve `timestamp` çeviri anahtarları eklendi. Backend `getTrolleyProductItems` servisinde veritabanı `data` sütununun okunması ve slot detay pop-up'ında geçmiş tork / PLC verilerinin eksiksiz görüntülenmesi sağlandı.
- [x] **Veritabanı Mimari Dokümantasyonu:** Veritabanının 23 tablosu ve aralarındaki ilişkiler Mermaid ER Diyagramı ile `database_schema_documentation.md` dosyasında tam dokümante edildi. Shell ID bazlı sorgulama rehberi hazırlandı.
- [x] **Nihai 2-Tablolu Sade Mimarisi (`trolleys` & `shells`):** Veritabanı `trolleys` (`trolley_id`, `capacity`) ve `shells` (`shell_id`, `trolley_id`, `slot_number`, `status`, `history`) fiziki tablolarına geçirildi. `plc_data` kolonu kaldırılarak tüm PLC ölçümleri ve istasyon verileri tekil `history` JSON dizisinde birleştirildi.
- [x] **QR Kod Üretim İstasyonu Akış İyileştirmesi:** Araba zorunluluğu kaldırıldı; "QR Kod Üret" butonunda otomatik Shell ID önerisini düzenlenebilir pop-up'ta sunan, benzersizlik doğrulaması yapan ve oluşturulan QR kodunu anında yazdıran akış tamamlandı.

## What Works (İstasyon turu #6+ ve Mimari Kararlar — 2026-08-02 → 2026-08-04)
- [x] **Slot Detay pop-up mükerrer veri düzeltmesi:** `capturePlcData` idempotency koruması (`hasRecord(productId, stationId, 'done')`) — aynı veri aynı shell içinde yalnızca BİR KEZ yazılır; pop-up tag başına tek (en güncel) kart gösterir; DB mükerrer kayıt temizlendi.
- [x] **Slot animasyon eşitlemesi:** QR kart efektleri (hover translateY(-3px) + amber glow, 0.25s transition, active scale) trolley slotlarına (`.trace-sim-slot` + `.trace-slot`) uygulandı.
- [x] **OPC Trolley ID otomatik aktif araba:** `GET /stations/:key/context` `trolleyIdTagId`'den okuyup aktif arabayı otomatik günceller; frontend `ctxLoaded` ile girme ekranı yanıp sönmesi engellendi; kayıtsız kod → `unknownTrolley` + danger Alert + spam'siz alarm.
- [x] **İstasyon yeniden adlandırma (Migration 8):** "Araba Atama" → "Trolley - Shell Eşleştirme".
- [x] **İstasyon bölme (Migration 9):** **Funnel Sıkma** (yeni, trolley_read+plc_acquire, rota önce) + **Trolley Yükleme** (trolley_read+trolley_assign, rota sonra). Backend'de `trolley_assign` engine desteği eklendi (tryAdvance/handleTrolleyRead/processScan/plc-data-watcher kapsamı).
- [x] **Mimari karar (2026-08-04): PLC = OPC UA Server, MES = OPC UA Client.** MES Bridge (MES'in OPC UA Server olması) yaklaşımı iptal + tamamen kaldırıldı (modül, frontend, DB kayıtları, debug patch'leri temizlendi; Migration 10 `mes_bridge_module_removed`).
- [x] **OK/Hata sonuç kontratı:** `StationConfig.ackTagId`/`errorTagId`/`errorMessageTagId` — `capturePlcData` her trigger sonucunu PLC'ye yazar (başarıda OK biti=true; hatada Hata biti=true + mesaj). StationsPage plc_acquire konfigürasyonunda üç dropdown + i18n (tr/en). **Yükselen kenarda temizleme:** `clearResult()` yeni işlem başlarken önceki çevrimin sonuçlarını PLC'de sıfırlar.

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

## Verification Commands
```bash
npm run typecheck                              # both packages
npm test --workspace=packages/backend          # backend tests
node scripts/opcua-sim.mjs [--secure|--auth u:p]
node scripts/modbus-sim.mjs
node scripts/recipe-api-test.mjs
```
