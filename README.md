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

## Erro HTTP 500 / mensagem sobre coluna não encontrada (Prisma)

Cada cliente tem seu **PostgreSQL separado**. Rodar apenas `prisma migrate deploy` com o `TENANT_DATABASE_URL` do `.env` atualiza **só esse** nome de banco — o JWT usa o campo `Tenant.databaseName` no banco **central** para montar a URL dos demais tenants. Após atualizar o código/schema, aplique migrações em **todos** os bancos de tenant:

```bash
cd apps/api
npm run tenant:migrate-all -w @gestorvend/api
```

Requer no ambiente `@gestorvend/api`/`apps/api`: `CENTRAL_DATABASE_URL` e um `TENANT_DATABASE_URL` “modelo” (mesmo host/credenciais; só o último segmento do nome do DB é substituído pelo de cada tenant), como em `scripts/migrate-all-tenants.ts`.

## `Cannot find module ... generated\...\index.js` (Prisma copiando para `dist`)

Os clientes Prisma ficam em `apps/api/src/generated/*`. O compilador Nest/TypeScript neste projeto gera entrada em **`dist/src/main.js`** (não em `dist/main.js`); ao lado ficam **`dist/src/prisma/...`** e o runtime precisa de **`dist/src/generated/...`** com `tenant-client/index.js`.

Após **`npm run build -w @gestorvend/api`**, o script **`apps/api/scripts/sync-generated-to-dist.cjs`** volta a copiar `src/generated` para `dist` (o `nest build` sozinho pode falhar a cópia no Windows).

Se o erro continuar:

1. Pare qualquer processo que use a API (PM2 / `node` contra `apps/api/dist`).
2. Apague **`apps/api/dist`**, rode `npm run prisma:generate -w @gestorvend/api`, depois `npm run build -w @gestorvend/api`.
3. Produção/manual: **`node apps/api/dist/src/main.js`** (ou `npm run start:prod` em `apps/api`).

Antigamente **`watchAssets`** no asset do Nest podia cortar cópias em build única — neste repo o asset não usa mais isso.

No Windows, `EPERM` ao apagar `.node` na pasta gerada é quase sempre **DLL em uso** (`query_engine-windows.dll.node`).

## Documentação

- [docs/FISCAL-HOMOLOG-NFC-E.md](docs/FISCAL-HOMOLOG-NFC-E.md) — checklist: variáveis `FISCAL_*`, tela **Empresa** (`/empresa`), primeiro teste NFC-e em homologação (`dry-run` e `soap`).
- [docs/FINANCIAL-OVERVIEW.md](docs/FINANCIAL-OVERVIEW.md) — balanço financeiro, plano referencial e importação.
- [docs/contexto.txt](docs/contexto.txt) — requisitos funcionais.
- [docs/MVP-ETAPA1.md](docs/MVP-ETAPA1.md) — escopo MVP.
- [docs/STACK.md](docs/STACK.md) — stack.
- [docs/TENANT-DESIGN.md](docs/TENANT-DESIGN.md) — multi-tenant e licença.
