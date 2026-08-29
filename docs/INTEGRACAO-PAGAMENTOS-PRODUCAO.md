# Webhooks e produção — Pagamentos PSP

Checklist para ativar Getnet e Mercado Pago em produção no GestorVend.

## Servidor

1. Defina `PUBLIC_API_BASE_URL=https://seu-dominio.com/api` no `.env` da API.
2. Defina `PAYMENT_CREDENTIALS_KEY` com chave longa e aleatória (32+ caracteres).
3. Garanta HTTPS válido no domínio público (obrigatório para webhooks).
4. Execute a migração tenant: `npm run prisma:migrate:tenant` (ou `tenant:migrate-all`).

## Getnet

1. Credenciais de **produção** no painel/contrato Getnet.
2. Em **Pagamentos** (`/pagamentos`): ambiente **Produção**, credenciais, channel e scope.
3. Configure no painel Getnet a URL de webhook exibida na tela (copiar exatamente).
4. Se exigido, informe usuário/senha HTTP Basic na configuração Getnet do GestorVend.

## Mercado Pago

1. Ative credenciais de **produção** em [Suas integrações](https://www.mercadopago.com.br/developers/panel/app).
2. Cadastre **chave PIX** na conta vendedor.
3. Webhooks → evento **Order (Mercado Pago)** → URL de produção (copiar da tela Pagamentos).
4. Cole o **secret de assinatura** em Pagamentos → Webhook secret.
5. Conclua homologação/qualidade no painel MP antes do go-live.

## Validação pós-deploy

- [ ] `POST /api/payments/pix/charges` gera QR em sandbox/produção
- [ ] Polling `GET /api/payments/intents/:id?refresh=1` atualiza status
- [ ] Webhook MP retorna 200 e confirma cobrança
- [ ] Venda PDV com `paymentIntentId` conclui e grava `externalTxnId`
- [ ] Cartão online MP marca conciliação SETTLED quando via intent

## Desenvolvimento local

Use ngrok ou Cloudflare Tunnel apontando para a API local e configure temporariamente `PUBLIC_API_BASE_URL` com a URL pública do túnel.
