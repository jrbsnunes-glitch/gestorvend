# Homologação Mercado Pago Point — GestorVend

Checklist para validar a integração **antes** de ativar cartão automático no autoatendimento (kiosk).

## Pré-requisitos

1. Conta Mercado Pago do **mesmo CNPJ** do Access Token configurado em **Configurações → Pagamentos**.
2. Maquininha **Point Smart** logada nessa conta.
3. Terminal Point em modo **PDV** (não STANDALONE).
4. Aplicação MP com permissão **Point / Orders** homologada no painel de desenvolvedores.
5. Webhook de **Order** apontando para:
   ```
   POST https://SEU_DOMINIO/api/webhooks/psp/MERCADO_PAGO?tenant=SLUG_EMPRESA
   ```

## 1. Verificar terminais Point na API

Com o Access Token de produção ou sandbox (`TEST-…`):

```bash
curl -s -H "Authorization: Bearer SEU_ACCESS_TOKEN" \
  "https://api.mercadopago.com/terminals/v1/list" | jq .
```

Se retornar 404 ou lista vazia, tente o endpoint legado:

```bash
curl -s -H "Authorization: Bearer SEU_ACCESS_TOKEN" \
  "https://api.mercadopago.com/point/integration-api/devices?limit=50&offset=0" | jq .
```

Anote o `terminal_id` / `id` do device (ex.: `PAX_A910__SMARTPOS1234345545`).

Confirme `operating_mode` = `PDV` ou equivalente integrado.

## 2. Configurar modo PDV (se necessário)

```bash
curl -s -X PATCH \
  -H "Authorization: Bearer SEU_ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"operating_mode":"PDV"}' \
  "https://api.mercadopago.com/terminals/v1/setup/TERMINAL_ID" | jq .
```

Consulte a [documentação oficial Point](https://www.mercadopago.com.br/developers/pt/docs/mp-point/overview) para o payload exato da sua versão de API.

## 3. Teste manual — criar ordem Point

Substitua `TERMINAL_ID`, valor e token:

```bash
curl -s -X POST \
  -H "Authorization: Bearer SEU_ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -H "X-Idempotency-Key: homolog-test-$(date +%s)" \
  -d '{
    "type": "point",
    "external_reference": "HOMOLOG-GV-001",
    "description": "Teste homologação GestorVend",
    "transactions": {
      "payments": [{
        "amount": "1.00",
        "payment_method": { "type": "credit_card" }
      }]
    },
    "config": {
      "point": {
        "terminal_id": "TERMINAL_ID",
        "print_on_terminal": "no_ticket"
      }
    }
  }' \
  "https://api.mercadopago.com/v1/orders" | jq .
```

**Esperado:** a ordem aparece na maquininha; após pagamento, status `processed`.

Consultar status:

```bash
curl -s -H "Authorization: Bearer SEU_ACCESS_TOKEN" \
  "https://api.mercadopago.com/v1/orders/ORDER_ID" | jq .
```

Cancelar ordem pendente:

```bash
curl -s -X POST \
  -H "Authorization: Bearer SEU_ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{}' \
  "https://api.mercadopago.com/v1/orders/ORDER_ID/cancel" | jq .
```

## 4. Teste webhook Order

Use um túnel (ngrok, cloudflared) em desenvolvimento:

```bash
ngrok http 3000
```

Configure no painel MP o webhook de **Orders** para:

```
https://xxxx.ngrok.io/api/webhooks/psp/MERCADO_PAGO?tenant=demo
```

Repita o passo 3 e confirme que o GestorVend recebe o evento (logs da API) e que o `PaymentIntent` muda para `CONFIRMED`.

## 5. Vincular no GestorVend (admin)

1. **Terminais PDV** → clique **Listar terminais MP** no terminal desejado.
2. Selecione o device Point no dropdown e salve.
3. No kiosk, o bootstrap retorna `hasPointIntegration: true` — cartão passa a confirmar automaticamente.

## Critérios de aceite

| Item | OK? |
|------|-----|
| Device listado na API MP | ☐ |
| Modo PDV ativo | ☐ |
| POST /v1/orders type=point carrega na maquininha | ☐ |
| Pagamento teste → status processed | ☐ |
| Webhook atualiza PaymentIntent | ☐ |
| PDV vinculado no admin GestorVend | ☐ |

Quando todos estiverem marcados, prossiga para o [checklist de go-live](MP-POINT-GO-LIVE.md).
