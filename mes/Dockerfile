# ─── Build Aşaması ──────────────────────────────────────────────────────────
FROM node:20-alpine AS build

WORKDIR /app

# better-sqlite3 native modülü için derleme araçları (musl prebuild yoksa)
RUN apk add --no-cache python3 make g++

# Workspace manifest'leri (katman cache'leme için önce kopyalanır)
COPY package.json package-lock.json ./
COPY packages/backend/package.json ./packages/backend/
COPY packages/frontend/package.json ./packages/frontend/

RUN npm ci --no-audit --no-fund

# Kaynak kod
COPY packages ./packages
COPY scripts ./scripts

# Frontend build + backend build + frontend'i backend/dist/public'e kopyala
RUN npm run build

# Sadece production bağımlılıkları kalsın
RUN npm prune --omit=dev

# ─── Çalışma Aşaması ────────────────────────────────────────────────────────
FROM node:20-alpine

ENV NODE_ENV=production

WORKDIR /app

COPY --from=build /app/package.json ./package.json
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/packages/backend/package.json ./packages/backend/package.json
COPY --from=build /app/packages/backend/dist ./packages/backend/dist

# Veritabanı ve upload dizinleri (volume mount noktaları)
RUN mkdir -p /app/data /app/uploads

# staticRoot çözümlemesi cwd bazlı: /app/packages/backend/dist/public
WORKDIR /app/packages/backend

EXPOSE 3000

CMD ["node", "dist/server.js"]