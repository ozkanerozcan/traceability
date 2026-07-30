# Product Context — OE MES

## Why This Project Exists
OE needs a **multi-customer, modular, configurable MES** it can sell repeatedly. Factories run air-gapped local networks, so the product must be self-contained (single container, no cloud dependency) and work without internet access.

## Problems It Solves
1. **Shop-floor data collection** — Machines expose data via Modbus (TCP/RTU) or OPC UA. The system connects, polls/subscribes, and normalizes values (scaling, data types, quality).
2. **Production traceability** — Work orders (iş emirleri) bound to recipes (reçeteler) define which tags to record; time-series data lands in `data_log` for later analysis.
3. **Live visibility** — Operators watch live dashboards (per work order) and a Live Monitor (no active work order needed) via WebSocket push.
4. **Security on the plant floor** — OPC UA certificate trust (TOFU), encrypted credential storage, JWT auth, role-based permissions (admin/supervisor/operator), audit trail.
5. **Operational resilience** — Server restart auto-resumes active work orders and PLC connections; SQLite WAL + auto-backup before migrations; DB size warning → archive flow.

## How It Should Work (User Flows)
- **Admin setup:** login (forced password change first time) → create PLC profiles (protocol-specific forms) → define tags (manual address or OPC UA Node Browser) → test connection → live status online/offline/cert_pending.
- **Recipe building:** create recipe → map PLC tags (TagMapper/TagSelect) → build dashboard template with drag-drop widgets (react-grid-layout) → widgets configured via popup (tag binding, gauge min/max, trend window, etc.).
- **Production run:** create work order from recipe → activate → DataCollector writes tag values to SQLite (transaction batching, 1s) → operators view live dashboard (view-only for operators).
- **OPC UA trust flow (TOFU):** first SignAndEncrypt connection rejected → cert saved as `pending` → admin reviews subject/thumbprint in CertificateTrustPanel → "Güven" (trust) → worker auto-reconnects → online. Audit logged (`trust_cert`).
- **System admin:** user management, operator permission editor, module enable/disable, branding, DB archive (blocked while a work order is active; only `data_log` is cleared, config preserved), audit log viewer.

## User Experience Goals
- **Turkish-first UI** (default `tr`), English available; dark theme default, light available.
- **Single port simplicity:** port 3000 serves API + frontend + WS in production; Vite dev server (5173) proxies `/api` and `/ws` to 3000 in development.
- **Responsive** (desktop/tablet/mobile), PWA installable ("ana ekrana ekle").
- **Predictable feedback:** standard error envelope `{ error: { code, message, details } }`; live WS status events; toasts via ErrorBoundary infrastructure.
- Operators get **view-only** dashboards; template editing only in Recipe screen by Admin/Supervisor.

## Key Personas
| Role | Capabilities |
|------|-------------|
| admin | Everything: users, settings, modules, branding, archive, cert trust |
| supervisor | Manage recipes, work orders, dashboard templates |
| operator | View dashboards, start/pause/complete work orders (permissions configurable via `role_permissions`) |
