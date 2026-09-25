# WhatsApp — bot Fábrica (integrado ao GestorVend)

O atendimento automático de **catálogo fabricado → lead → handoff** roda **na API NestJS** do GestorVend. Não é necessário serviço externo GestorVendChat.

## Pré-requisitos

| Item | Onde |
|------|------|
| Plano **WHATSAPP** | Portal / tenant central |
| Addon **FÁBRICA** | Empresa → Fábrica |
| PAs publicados | Produto → `showInPublicCatalog` + PA fabricável + variante com preço |
| Fotos / textos | Produto → aba Imagem + descrição; loja `/loja` e bot reutilizam o mesmo catálogo |
| Meta Cloud API | Phone number ID + token de acesso |

## Configuração (Empresa → Fábrica)

1. Ative **Bot WhatsApp (orçamento fabricado)**.
2. Informe **Phone number ID** e **Token de acesso** (Meta).
3. No app Meta, configure o webhook:
   - URL: `https://{seu-dominio}/api/webhooks/whatsapp/factory`
   - Verify token: valor de `WHATSAPP_WEBHOOK_VERIFY_TOKEN` no `.env` da API (padrão `gestorvend-factory`).
4. Salve a empresa — o Phone number ID é indexado no banco **central** para rotear mensagens ao tenant correto.
5. **Catálogo público**: mensagem do link WhatsApp na loja (`{codigo}`, `{nome}`).
6. **Textos do bot** (opcional): boas-vindas, menu, mensagem após confirmar pedido (`{numero}`). Vazio = padrões em `wachat-factory-copy.ts`.

Variáveis de ambiente:

- `PUBLIC_WEB_BASE_URL` — link da loja `/loja/{slug}` em fallback.
- `PUBLIC_API_BASE_URL` — URL pública da API (ex.: `https://app.seudominio.com`) para o bot **enviar fotos** dos produtos via Meta (`/api/catalog/.../image`).

## Fluxo conversacional

Menu → catálogo paginado → escolha → quantidade → observação → confirmação → cria **ManufacturingProject** (`WHATSAPP_LINK`, `externalRef` `wa:…`) → mensagem de handoff.

Consultor: **Fábrica → Projetos** (filtro WhatsApp) → orçamento → PDF → envio manual no WhatsApp.

## Endpoints

### Webhook Meta (público)

- `GET /api/webhooks/whatsapp/factory` — verificação `hub.challenge`
- `POST /api/webhooks/whatsapp/factory` — mensagens; respostas via Graph API

### Bridge / testes (header `X-WaChat-Key` = `WACHAT_API_KEY`)

- `GET /api/wachat/factory/catalog?tenantSlug=`
- `POST /api/wachat/factory/leads`
- `GET /api/wachat/factory/leads/by-ref?tenantSlug=&externalRef=`
- `POST /api/wachat/factory/inbound` — body `{ tenantSlug, fromPhone, text, customerName? }` → `{ replies: Array<{ type: 'text', body } | { type: 'image', url, caption? }> }`
- `POST /api/wachat/factory/inbound/send` — igual + envia respostas pelo Meta

Exemplo de teste local:

```bash
curl -X POST http://127.0.0.1:3000/api/wachat/factory/inbound \
  -H "Content-Type: application/json" \
  -H "X-WaChat-Key: SEU_SEGREDO" \
  -d "{\"tenantSlug\":\"demo\",\"fromPhone\":\"5511999999999\",\"text\":\"menu\"}"
```

## Operação do atendente

1. Filtrar origem **WhatsApp (bot / link)**.
2. Projetos com badge **Bot** (`externalRef` prefixo `wa:`).
3. Preencher orçamento, imprimir PDF, responder no WhatsApp Business.

## Segurança

- Token Meta armazenado no banco do tenant (Empresa); restrinja acesso ao banco.
- `WACHAT_API_KEY` só para endpoints de bridge/teste.
- Catálogo expõe apenas PAs públicos (sem BOM).
