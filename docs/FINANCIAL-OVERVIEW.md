# Balanço financeiro e plano referencial



## API



- `GET /api/financial-overview/summary` — sem query: **período acumulado** de `max(01/01/2026, início do dia do primeiro registro entre: venda concluída, movimento de caixa, conta a pagar ou a receber)` até o fim do dia atual. Se não houver registros, usa só 01/01/2026 → hoje.

- **Saldo “caixa da loja” (inferido)** inclui:

  - entradas/saídas de `CashMovement`;

  - pagamentos de vendas (`SalePayment`, exceto crediário);

  - **liquidações em `PayableSettlement` / `ReceivableSettlement` sem sessão de caixa** (`cashSessionId` nulo), com o **valor pago** em cada operação (parcial ou total); títulos **PAID** antigos sem essas linhas usam fallback nos totais.

- Abertura do período inclui, da mesma forma, liquidações **antes** de `from` (mesmas regras), para manter o saldo inicial coerente.

- Resposta inclui **`storePosition`** e **`ledger`** (até 800 linhas). Liquidações de a pagar/a receber usam tabelas **`PayableSettlement`** / **`ReceivableSettlement`** (valor pago em cada operação, **parcial ou total**). No diário, linhas de título quitado **sem** repetir o movimento de caixa equivalente (`Pagamento:` / `Recebimento:`). Títulos **PAID** anteriores à migração sem linhas de liquidação entram por **fallback (legado)** nos totais.

- `GET /api/financial-overview/summary?from=YYYY-MM-DD&to=YYYY-MM-DD` — **ambas** as datas obrigatórias para intervalo customizado. Uma só data retorna erro 400.

- `GET /api/financial-overview/referential-accounts?search=&sourceVersion=` — lista contas importadas do plano referencial.



Papéis: `admin`, `manager`, `finance`.



## Web



- `/balanco` — visão **acumulada**, cards de posição e **Diário** com export CSV.

- `/balanco/relatorios` — intervalo **de/até**, mesmo diário, CSV e impressão (`/balanco/impressao?from=&to=`).



## Importação do plano (RFB / layout ECD)



Substitua o JSON de exemplo por arquivo oficial quando for integrar ao SPED.



```bash

cd apps/api

set TENANT_DATABASE_URL=postgresql://...

npm run import:referential-accounts -- path/para/contas.json MinhaVersao-2026

```



Sem argumentos, usa `prisma/seed-data/referential-accounts-sample.json` e `sourceVersion=RFB-sample-v1`.



## Limitações (fase 1)



- É necessário **migrar o banco do tenant** após atualizar o código (`PayableSettlement` / `ReceivableSettlement`).

- Pagamentos/recebimentos passam a gerar linha de liquidação com o **valor pago** (parcial ou total). Títulos quitados **antes** da migração podem aparecer como **(legado)** no diário se não houver linhas importadas.

- Posição aproximada da loja é **indicativa** (não substitui balanço contábil).

- Liquidações “no período” nos agregados de títulos continuam usando `paidAt` / `receivedAt` em títulos com status `PAID`.


