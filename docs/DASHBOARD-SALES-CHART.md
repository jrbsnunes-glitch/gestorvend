# Gráfico “Evolução de vendas no mês” (Início)

## Como os dados são calculados

- Fonte: vendas **`COMPLETED`** na tabela `Sale`, filtradas do 1º dia do mês até hoje (fim do dia).
- Agregação: **SQL** `GROUP BY` dia civil no fuso **`APP_TIMEZONE`** (padrão `America/Sao_Paulo`), função PostgreSQL `timezone(tz, "createdAt")`.
- Endpoint: `GET /api/dashboard/overview` (`salesTrendMonth`) e `GET /api/dashboard/sales-trend-month` (usado pelo gráfico).

## Front

- Componente: `apps/web/src/components/SalesMonthChart.tsx` (barras por dia, tooltip no hover/teclado).
- Eixo: sempre dia **01 → hoje**, montado no front (`apps/web/src/lib/month-sales-chart.ts`) e mesclado com os totais da API.
- A query usa a chave do mês (`YYYY-MM`), então a contagem **reinicia sozinha ao virar o mês**.
- Destaques: melhor dia (verde), dia com menos vendas (âmbar), média por dia com vendas (linha tracejada), variação do dia vs dia anterior.

## Deploy

Web e API devem estar na **mesma versão** (≥ v1.0.96 para agregação SQL). Após `git pull`:

```bash
npm run build
# reiniciar API
```

Confirme no `.env` da API: `APP_TIMEZONE=America/Sao_Paulo` (ou fuso da loja).

## Sintomas antigos (corrigidos)

| Sintoma | Causa |
|---------|--------|
| Tudo num único dia / “detalhe diário indisponível” | Fallback do front quando a API não enviava série diária correta |
| “Sem vendas no mês” com faturamento no card | Campo `salesTrendMonth` ausente ou vazio na API antiga |
| Melhor dia com horário estranho | Data `YYYY-MM-DD` interpretada como UTC no `formatDate` |
