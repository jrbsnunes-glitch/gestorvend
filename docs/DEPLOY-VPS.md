# Deploy GestorVend na VPS (Nginx + outro sistema)

Guia para publicar em uma VPS (ex.: Hostinger) que já usa Nginx para outro site. O repositório inclui exemplos em [`deploy/`](../deploy/).

## Arquitetura

- **Subdomínio** dedicado (ex.: `gestorvend.seudominio.com`) — novo `server { }` no Nginx sem alterar o site existente.
- **Front**: arquivos estáticos de `apps/web/dist` (build Vite).
- **API**: Nest em `127.0.0.1:3000` (ou outra porta), prefixo `/api`.
- O cliente usa URLs relativas `/api/...` quando o build **não** define `VITE_API_BASE_URL` — ideal para proxy na mesma origem.

## 1) DNS e TLS

1. Aponte um registro **A** (ou CNAME) do subdomínio para o IP da VPS.
2. Emita certificado TLS (ex.: Let's Encrypt / certbot). O exemplo Nginx reserva `/.well-known/acme-challenge/` em HTTP.

## 2) Código e Node

```bash
sudo mkdir -p /opt/gestorvend && sudo chown "$USER":"$USER" /opt/gestorvend
cd /opt/gestorvend
git clone https://github.com/jrbsnunes-glitch/gestorvend.git .
# Node.js 20+
npm ci
```

Não use `npm ci --ignore-scripts`: o projeto depende dos scripts de pós-instalação (e do `npm run build`) para gerar os clients Prisma em `apps/api/src/generated/` (pastas ignoradas pelo Git). Sem isso, o `dist` da API pode subir sem `central-client` e o PM2 falha com `Cannot find module '../generated/central-client'`.

## 3) PostgreSQL e Redis

**Opção A — Docker** (somente postgres + redis do repositório):

```bash
docker compose up -d
```

Use portas/host de [`docker-compose.yml`](../docker-compose.yml) nos URLs do `.env` (ex.: `localhost:5433`, `localhost:6380`).

**Opção B — Serviços no SO**: crie os databases central e tenant (veja [`docker/postgres/init.sql`](../docker/postgres/init.sql) como referência) e ajuste `CENTRAL_DATABASE_URL`, `TENANT_DATABASE_URL`, `REDIS_URL`.

Em produção, configure `TENANT_ADMIN_DATABASE_URL` com usuário que possa `CREATE DATABASE` para provisionamento de tenants.

## 4) Variáveis de ambiente

```bash
cp .env.example .env
cp .env.example apps/api/.env
```

Edite **os dois** com os mesmos valores. Inclua, quando for publicar só atrás do Nginx:

- `HOST=127.0.0.1` — a API não fica exposta na rede, só local.
- `PORT=3000` — alinhar com o `upstream` no Nginx (ou altere ambos).

Defina JWT e URLs de banco com **segredos fortes**. Não commite `.env`.

## 5) Migrations e build

```bash
cd apps/api
npx prisma migrate deploy --schema=prisma/central/schema.prisma
npx prisma migrate deploy --schema=prisma/tenant/schema.prisma
cd ../..
```

Seed / superadmin (só se necessário, com cuidado em produção):

```bash
npm run seed -w @gestorvend/api
# ou scripts em apps/api/scripts/
```

**Build** (não defina `VITE_API_BASE_URL` se usar proxy `/api` no mesmo host):

```bash
npm run build
```

O script `build` na raiz executa **`npm run db:generate`** antes do Nest (ambos os schemas Prisma), garantindo que `src/generated/` exista e seja copiada para `apps/api/dist/` no `nest build`.

Saídas: `apps/api/dist/`, `apps/web/dist/`.

## 6) Serviço da API

**systemd**: copie e ajuste [`deploy/systemd/gestorvend-api.service.example`](../deploy/systemd/gestorvend-api.service.example).

**PM2**: veja [`deploy/pm2/ecosystem.config.cjs.example`](../deploy/pm2/ecosystem.config.cjs.example).

Garanta que `WorkingDirectory`/`cwd` seja `apps/api` e que `EnvironmentFile` ou `env_file` aponte para `apps/api/.env`.

## 7) Nginx

1. Copie [`deploy/nginx/gestorvend.conf.example`](../deploy/nginx/gestorvend.conf.example) para `sites-available`, ajuste `server_name`, `root`, caminhos SSL.
2. Ative o site (symlink em `sites-enabled`).
3. `sudo nginx -t && sudo systemctl reload nginx`

## 8) Verificação (smoke test)

Com a API rodando:

```bash
curl -sS http://127.0.0.1:3000/api/health
# {"status":"ok","service":"gestorvend-api"}
```

No navegador (HTTPS):

- Página inicial / login do tenant.
- `https://seudominio/portal-admin` — portal de licenciamento (rota SPA).

Configure **backup** periódico do PostgreSQL.

## Atualização

```bash
cd /opt/gestorvend
git pull
npm ci
cd apps/api && npx prisma migrate deploy --schema=prisma/central/schema.prisma && npx prisma migrate deploy --schema=prisma/tenant/schema.prisma && cd ../..
npm run build
sudo systemctl restart gestorvend-api   # ou pm2 restart gestorvend-api
```

Se alterar qualquer variável `VITE_*`, rode `npm run build` de novo antes de publicar o `dist`.

## API em subdomínio separado

Se a API for `https://api.seudominio.com`, defina no **momento do build**:

`VITE_API_BASE_URL=https://api.seudominio.com`

e configure CORS na API apenas para o domínio do front (revisar `enableCors` em produção).
