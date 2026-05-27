# Multi-tenant e licenciamento (GestorVend)

## Banco central

Tabela `Tenant` (Prisma: `apps/api/prisma/central/schema.prisma`):

- `slug`: identificador na URL/API (ex.: subdomínio ou header).
- `cnpj`: **âncora de licença** (único).
- `licenseStatus` / `licenseExpiresAt`: controle comercial.
- `databaseName`: nome do database PostgreSQL dedicado (ex.: `gestorvend_tenant_dev`).

## Banco por cliente

Mesmo schema Prisma (`prisma/tenant/schema.prisma`) aplicado em cada database via `prisma migrate deploy` com `TENANT_DATABASE_URL` apontando para o DB correto.

Runtime: `TenantPrismaService` resolve o tenant pelo `slug`, lê `databaseName` no central e monta a URL trocando o último segmento de `TENANT_DATABASE_URL` (template).

## Autenticação

`POST /api/auth/login` envia `tenantSlug`, `email` e `password`. O JWT inclui `tenantSlug` e roles; todas as rotas protegidas usam esse slug para obter o `PrismaClient` do tenant.

## Licença

`TenantService.assertLicenseActive` exige `trial` ou `active` e data de expiração futura (se definida). Chamado no login e reutilizável em operações críticas.

## Novo cliente

1. `CREATE DATABASE` no PostgreSQL (ou automação com superusuário).
2. Registrar linha em `Tenant` (script `provision-tenant.ts`).
3. Rodar migrations de tenant nesse database (`tenant:migrate-all` ou deploy manual com URL específica).
4. Popular papéis/usuários (seed específico ou convite).

## Emissão NFC-e (credenciais por tenant)

Caminho do `.pfx`, **senha do certificado**, **CSC ID** e **token CSC** podem ser guardados em **`FiscalIssuerSettings`** (por tenant, no banco do cliente), editáveis pelo painel em **Empresa** (bloco emissor). As variáveis `FISCAL_ISSUER_CERT_*` e `FISCAL_NFCE_CSC*` no `.env` da API funcionam como **fallback** quando um campo na base está vazio — útil para desenvolvimento ou um único emitente na instância.
