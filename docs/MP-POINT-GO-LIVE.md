# Go-live — Autoatendimento com Mercado Pago Point

Checklist para colocar um totem GestorVend em produção com **PIX QR automático** e **cartão crédito/débito** na maquininha Point.

## Infraestrutura

| Item | Detalhe |
|------|---------|
| Servidor | `main` atualizado; migração `mpPointTerminalId` aplicada em todos os tenants |
| Webhook MP | `POST /api/webhooks/psp/MERCADO_PAGO?tenant=SLUG` acessível pela internet (HTTPS) |
| Credenciais | Access Token produção em **Pagamentos**; mesmo CNPJ da conta Point |
| Homologação MP | App aprovada para Point no painel desenvolvedores |

## Por totem (1 Point = 1 PDV numerado)

1. **Cadastrar PDV** em Terminais PDV (modo Autoatendimento).
2. **Vincular maquininha:** Listar terminais MP → escolher o device Point correto.
3. **Token de pareamento:** copiar para o app Desktop (kiosk) ou tela `/auto-atendimento?terminal=N`.
4. **Electron kiosk** (recomendado): fullscreen, impressora PDV configurada, `pdvTerminal` no config.
5. **Caixa:** operador vinculado ao terminal ou vendedor padrão com sessão aberta (criada automaticamente no bootstrap).

## Formas de pagamento

- Cadastro ativo **PIX** e **Cartão** (CARD) em Formas de pagamento.
- Terminal PDV com `allowedMethods` incluindo `PIX`, `CARD_CREDIT`, `CARD_DEBIT`.

## Testes obrigatórios (antes de abrir ao público)

Execute na ordem, no hardware real:

| # | Teste | Resultado esperado |
|---|-------|-------------------|
| 1 | PIX QR na tela | QR exibido → pagamento → venda concluída sem toque manual |
| 2 | Crédito Point | Ordem na maquininha → cartão → venda concluída automaticamente |
| 3 | Débito Point | Idem com `debit_card` |
| 4 | Cupom | Impressão 80mm (Electron) ou tela de impressão |
| 5 | Timeout / cancelar | Cliente desiste → voltar ao carrinho; ordem MP cancelada |
| 6 | Segunda venda seguida | Sem ordem “presa” na maquininha |

## Operação

- **Sem Point vinculado:** kiosk mantém botão manual “Pagamento concluído na maquininha”.
- **Com Point vinculado:** confirmação automática via webhook + polling.
- **Conciliação:** `SalePayment` com `authCode`/NSU do metadata do `PaymentIntent`.
- **Suporte:** se a maquininha ficar em STANDALONE, reconfigurar modo PDV (ver [homologação](MP-POINT-HOMOLOGACAO.md)).

## Rollback

1. Remover `mpPointTerminalId` do PDV no admin → volta ao fluxo manual.
2. Desativar terminal PDV se necessário.
3. Não é necessário redeploy para rollback operacional.
