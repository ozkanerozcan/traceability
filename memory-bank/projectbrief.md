# Project Brief — OE MES (Manufacturing Execution System)

## Overview
**OE MES** is a modular, configurable MES web application built for OE, sellable to multiple customers. It collects data from PLCs and OPC UA servers, performs work-order-based production tracking, and runs **air-gapped** on factory local networks.

- **Working directory root:** `c:\Users\ozkanerozcan\Desktop\Traceability`
- **Application root:** `mes/` (npm workspaces monorepo)
- **Master plan:** `implementation_plan.md` (v3, Turkish) — the authoritative spec; approved decisions are listed at its end.

## Core Requirements
1. **PLC/OPC UA data collection** — Modbus TCP, Modbus RTU, and full OPC UA (node-opcua): subscription-first, browse, certificate trust (TOFU), encrypted credentials.
2. **Work-order-based production tracking** — recipes define tag mappings + dashboard templates; work orders activate data logging to SQLite.
3. **Modular architecture** — backend modules implement `IModule`, can be enabled/disabled from admin panel (state in `modules` table).
4. **Air-gapped deployment** — Docker Compose, single container, single port (3000) serving API + frontend + WebSocket.
5. **Multi-customer configurability** — branding (logo, company name, "Powered by OE"), TR/EN i18n, dark/light themes.

## Tech Stack (decided)
| Layer | Technology |
|-------|-----------|
| Frontend | React 18, Vite, TypeScript, Zustand, react-router-dom v6, react-grid-layout, Recharts, react-i18next, lucide-react, vite-plugin-pwa |
| Backend | Node.js ≥20, Fastify 5, TypeScript, better-sqlite3 (WAL), @fastify/jwt + httpOnly cookie, bcryptjs |
| PLC Comms | modbus-serial (TCP+RTU), node-opcua (client + subscription), Node.js Worker Threads |
| Secrets | Node crypto AES-256-GCM (`secret.service.ts`), key from `ENCRYPTION_KEY` (or derived from `JWT_SECRET` via scrypt) |
| Deployment | Docker Compose, single service `mes-app`, volumes `mes-data` + `mes-uploads` |

## Monorepo Layout
```
mes/
├── docker-compose.yml, Dockerfile, .env.example, README.md, start.bat
├── packages/
│   ├── backend/    # Fastify + SQLite + Modbus/OPC UA (@oe-mes/backend)
│   │   └── src/{core,modules,shared} — core: database, auth, crypto, websocket, module-system, audit
│   └── frontend/   # React + Vite + PWA (@oe-mes/frontend)
│       └── src/{core,modules,shared} — core: Layout, Theme, Language, store, services, i18n
└── scripts/        # copy-frontend.mjs, modbus-sim.mjs, opcua-sim.mjs, opcua-diag.mjs,
                    # recipe-api-test.mjs, ws-test.mjs, ws-watch.mjs
```

## Goals / Success Criteria
- 7 implementation phases (~18 work-days total estimate, single developer):
  1. Temel Altyapı (core infra) ✅
  2. PLC Gateway (Modbus + OPC UA) ✅
  3. Reçete Yönetimi (recipe mgmt) — in progress
  4. İş Emri Yönetimi (work orders)
  5. Dashboard (widgets)
  6. Sistem Yönetimi (users, settings, archive, audit)
  7. PWA & Polish
- Verifiable via `npm run typecheck`, backend tests, and simulator-based end-to-end frontend test scenarios (see implementation_plan.md → Doğrulama Planı).

## Default Credentials
`admin` / `admin` (role: admin) — `must_change_password=1` forces change on first login.
