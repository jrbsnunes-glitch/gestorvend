# Portal de licenças — deploy alinhado (web + API)

O portal (`/portal-admin`) e a API (`/api/portal/*`) **precisam da mesma versão**. Atualizar só o front gera erros do tipo `Cannot GET/PATCH /api/portal/clients/...`.

## Checklist no servidor

```bash
cd /var/www/gestorvend
git pull origin main
npm ci

# Banco central (enum FACTORY, grants)
npm run db:migrate:central

# Template tenant + todos os tenants
npm run db:migrate:tenant
npm run tenant:migrate-all -w @gestorvend/api

npm run build
# Reiniciar processo da API (pm2/systemd) — obrigatório após build da API
```

## Rotas usadas pelo portal

| Rota | Uso |
|------|-----|
| `GET /api/portal/clients` | Lista (sempre existiu) |
| `PATCH /api/portal/clients/:cnpj/license` | Dados da licença + `enabledAddons` (legado) |
| `PATCH /api/portal/clients/:cnpj/modules` | Só addons (API ≥ v1.0.92) — opcional; o front faz fallback para `/license` |

`GET /api/portal/clients/:cnpj` existe na API nova, mas **o portal não depende mais dela** para abrir Editar.

## Addon Fábrica

1. Migration central `20260914120000_tenant_module_factory` (valor `FACTORY` no enum).
2. Portal: marcar **Adicional: Fábrica** e salvar.
3. No tenant: **Empresa → Fábrica → Usar módulo Fábrica**.
