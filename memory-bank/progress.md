# Progress — OE MES

> Status snapshot: **2026-07-29**. Source of truth for scope: `implementation_plan.md` (v3).

## Phase Status

| Phase | Scope | Status |
|-------|-------|--------|
| Faz 1 | Temel Altyapı (core infra) | ✅ Complete |
| Faz 2 | PLC Gateway (Modbus + OPC UA) | ✅ Complete |
| Faz 3 | Reçete Yönetimi (recipes) | 🔶 In progress |
| Faz 4 | İş Emri Yönetimi (work orders) | ⬜ Not started |
| Faz 5 | Dashboard (widgets) | ⬜ Not started |
| Faz 6 | Sistem Yönetimi (users/settings/archive/audit) | ⬜ Not started |
| Faz 7 | PWA & Polish | ⬜ Not started |

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

## In Progress (Faz 3)
- [x] Backend recipe module (`recipe.routes.ts`, `recipe.service.ts`) registered in module system
- [x] Frontend: RecipeList, RecipeForm, TagSelect (tag mapping), DashboardEditor (react-grid-layout), recipe.service, recipe.css
- [ ] Recipe protection rules (block delete/edit when in use by work orders)
- [ ] End-to-end verification of dashboard layout save (`PUT /api/recipes/:id/dashboard`)

## Not Started
- Faz 4: work-order CRUD, `WO-YYYYMMDD-NNN` numbering, status machine, DataCollector (transaction batching, quality/value_text), permissions
- Faz 5: widget palette + config popup, Numeric/Gauge/Trend/Status/Table widgets, live updates, WO switching, recipe preview
- Faz 6: user mgmt, operator permissions editor, settings panels, module manager, branding, DB archive (interlock: no active WO; clears only `data_log`), audit viewer
- Faz 7: service worker, offline cache, manifest/icons, responsive polish, Docker optimization

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

- Frontend route placeholders exist for pages not yet built (`/work-orders`, `/users`, `/settings`, `/audit` missing from App.tsx — noted as "Faz 4-6" comment).
- `DashboardPage` exists but the widget system (Faz 5) isn't implemented.
- No work-order backend module yet → DataCollector not yet writing `data_log`.

## Verification Commands
```bash
npm run typecheck                              # both packages
npm test --workspace=packages/backend          # backend tests
node scripts/opcua-sim.mjs [--secure|--auth u:p]
node scripts/modbus-sim.mjs
node scripts/recipe-api-test.mjs
```

## Evolution Log
- **2026-07-29:** Memory Bank initialized. Assessed: Faz 1–2 done, Faz 3 in progress (recipe module + dashboard editor present; protection rules + e2e verification remaining).
