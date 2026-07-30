# Tech Context — OE MES

## Runtime & Tooling
- **Node.js ≥ 20** (engines field), npm workspaces monorepo, Windows dev machine (cmd.exe shell), Docker for production.
- Root scripts (`mes/package.json`):
  - `npm run dev:backend` → tsx watch, http://localhost:3000
  - `npm run dev:frontend` → Vite, http://localhost:5173 (proxies `/api` + `/ws` → 3000)
  - `npm run build` → frontend build + backend build + `scripts/copy-frontend.mjs` (dist → backend static root)
  - `npm start` → production server on :3000
  - `npm run typecheck` → `tsc --noEmit` both packages
  - Backend tests: `npm test --workspace=packages/backend` (`node --test --import tsx src/**/*.test.ts`)

## Backend (`@oe-mes/backend`)
| Dependency | Purpose |
|-----------|---------|
| fastify 5, fastify-plugin | HTTP framework |
| @fastify/cors | CORS (origin: true, credentials — air-gapped LAN) |
| @fastify/jwt | JWT auth |
| @fastify/cookie | httpOnly cookie sessions |
| @fastify/websocket | WS endpoint (`/ws`) |
| @fastify/static | Serve frontend build in production |
| better-sqlite3 12 | Embedded DB (WAL) |
| bcryptjs | Password hashing |
| modbus-serial 8 | Modbus TCP + RTU |
| node-opcua 2.x | OPC UA client, subscription, PKI (pure JS — no native build, alpine-safe) |
| dotenv | Env loading |
- Dev: typescript 5.8, tsx 4 (watch runner), @types/*.
- Build: `tsc -p tsconfig.json` → `dist/`; entry `dist/server.js`.
- Imports use `.js` suffix (ESM/NodeNext style).

## Frontend (`@oe-mes/frontend`)
| Dependency | Purpose |
|-----------|---------|
| react 18 + react-dom | UI |
| react-router-dom 6 | Routing (nested, lazy) |
| zustand 5 | State management |
| react-i18next + i18next | i18n (tr/en JSON locales) |
| react-grid-layout | Drag-drop dashboard layouts |
| recharts | Charts (trend widgets) |
| lucide-react | Icons |
| vite-plugin-pwa | PWA (Workbox, manifest) |
- Dev: vite 6, @vitejs/plugin-react, typescript.
- Build: `tsc --noEmit && vite build` → `dist/`.
- No CSS framework — custom CSS variables + theme files.

## Environment Variables (`.env.example`)
| Variable | Description | Default |
|----------|-------------|---------|
| `JWT_SECRET` | JWT signing key (**required**) | — |
| `ENCRYPTION_KEY` | AES-256 key for PLC/OPC UA credentials (64 hex) | derived from JWT_SECRET (scrypt, warning logged) |
| `PORT` | HTTP/WS port | `3000` |
| `DB_PATH` | SQLite file path | `./data/mes.db` |
| `LOG_LEVEL` | Fastify log level | `info` |

## Docker Deployment
- `Dockerfile`: node:20-alpine multi-stage — backend build, frontend build, `cp -r frontend/dist backend/dist/public`, `npm prune --production`, CMD `node packages/backend/dist/server.js`, EXPOSE 3000.
- `docker-compose.yml`: single service `mes-app`, ports `3000:3000`, volumes `mes-data` (`/app/data` — DB + `data/pki` OPC UA certs), `mes-uploads` (`/app/uploads` — logos), env from `.env`, `restart: unless-stopped`. RTU serial passthrough commented (`devices: /dev/ttyUSB0`).
- `start.bat` convenience launcher on Windows.

## Test Simulators & Scripts (`mes/scripts/`)
| Script | Purpose |
|--------|---------|
| `modbus-sim.mjs` | Local Modbus TCP server 127.0.0.1:5020 (ramp/random/sine) |
| `opcua-sim.mjs` | Local OPC UA server opc.tcp://127.0.0.1:4840; flags `--secure` (SignAndEncrypt+Basic256Sha256), `--auth user:pass`; test tags under ns=2 (`Sim.Bool/Counter/Temperature/Pressure/Status/Setpoint`) |
| `opcua-diag.mjs` | OPC UA diagnostics |
| `ws-test.mjs` / `ws-watch.mjs` | WS connection + `plc:data` flow verification / watching |
| `recipe-api-test.mjs` | Recipe API integration test |
| `copy-frontend.mjs` | Copies frontend dist into backend static root during build |

## Constraints & Notes
- **Air-gapped:** no external network calls at runtime; all deps vendored via package-lock.
- `node-opcua` is pure JS → works on alpine without build tools.
- SQLite data + PKI certs must live on the `mes-data` volume for persistence.
- Dev workflow: run backend + frontend (+ simulators) in separate terminals; use http://localhost:5173.
