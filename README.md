# GestorVend

ERP para varejo (Etapa 1: operacional; Etapa 2: fiscal). Multi-tenant com **um banco PostgreSQL por cliente**, catálogo de licenças por **CNPJ** no banco central.

## Pré-requisitos

- Node.js 20+
- Docker (PostgreSQL 16 e Redis 7)

## Configuração rápida

1. Copie `.env.example` para `.env` na raiz e para `apps/api/.env` (mesmos valores).
2. Opcional: copie `apps/web/.env.development.example` para `apps/web/.env.development` se quiser fixar `VITE_API_BASE_URL` (o padrão já usa o proxy do Vite).
3. `docker compose up -d` (Postgres em `localhost:5433`, Redis em `6380`).
4. `cd apps/api && npx prisma migrate deploy --schema=prisma/central/schema.prisma && npx prisma migrate deploy --schema=prisma/tenant/schema.prisma`
5. `npm run seed -w @gestorvend/api`
6. `npm run dev:api` (API em http://localhost:3000/api) e em outro terminal `npm run dev:web` (UI em http://localhost:5173).

Login seed: tenant `demo`, e-mail `admin@demo.local`, senha `Admin123!`.

## Scripts úteis

- `npm run tenant:migrate-all -w @gestorvend/api` — aplica migrations do schema de tenant em todos os databases listados no banco central.
- `npx ts-node -r tsconfig-paths/register apps/api/scripts/provision-tenant.ts <slug> <cnpj> <nome> <databaseName>` — registra novo tenant (o `CREATE DATABASE` deve ser feito no PostgreSQL antes).

## Documentação

- [docs/DEPLOY-VPS.md](docs/DEPLOY-VPS.md) — publicar na VPS (Nginx, systemd/PM2, Docker).
- [docs/contexto.txt](docs/contexto.txt) — requisitos funcionais.
- [docs/MVP-ETAPA1.md](docs/MVP-ETAPA1.md) — escopo MVP.
- [docs/STACK.md](docs/STACK.md) — stack.
- [docs/TENANT-DESIGN.md](docs/TENANT-DESIGN.md) — multi-tenant e licença.
