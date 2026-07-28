# Gestão de estoque: compostos, gelo/balde e venda a peso

Documento operacional do GestorVend. O estoque **real** fica no SKU **unitário**. O produto **composto** (caixa/pack/kg de NF) aponta para o unitário e multiplica a quantidade pelo fator (`packItemQty` ou número em `conversion`).

| Campo | Uso |
|-------|-----|
| `conversion` | Unidade como na NF (ex.: `CX`, `CX-12`, `KG`) |
| `packItemQty` | Itens unitários por embalagem (prioridade no fator) |
| `stockComponentVariantId` | Variant do unitário onde sobe/baixa o saldo |

**Boas práticas gerais**

1. Cadastre **dois produtos** (embalagem de compra + unidade de venda/estoque).
2. Vincule o composto ao unitário com fator `> 1`.
3. Confira se o `uCom` da NF casa com a `conversion`.
4. Inventarie sempre o **unitário** (compostos são bloqueados no inventário).
5. No PDV, venda o SKU coerente com o que o cliente leva (em geral o unitário).

---

## Cenário 1 — Linguiça: compra em kg, vende em unidades

### Prática de varejo

Defina **uma unidade de controle** (peça ou kg) e um **fator** confiável (ex.: 1 kg ≈ N gomos). Sem fator, o sistema não converte kg em peças.

### Opção A — Vende por peça (recomendado se o caixa vende unidade)

1. Cadastre **Linguiça (unidade)** — estoque real, preço por peça, unidade tributável `UN`.
2. Cadastre **Linguiça (kg / NF)** como composto:
   - Conversão = unidade da NF (ex.: `KG`);
   - Itens por composto = peças por kg (média operacional, ex.: `20`);
   - Vincule ao produto unitário.
3. Na entrada da NF em kg, o saldo sobe em **peças** (`qtd_kg × fator`).
4. No PDV, venda o SKU **unitário**.
5. Inventarie **peças**. Divergência por variação de peso é normal — ajuste no inventário.

> Na tela de produtos: informe conversão `KG`, itens por composto e **Vincular produto**. O assistente “Cadastrar caixa + unitário” da entrada prioriza unidades de embalagem (`CX`, `PCT`…); para `KG` use o cadastro manual acima.

### Opção B — Vende a peso (kg)

1. Um único produto com unidade tributável `KG` e preço = R$/kg.
2. Entrada da NF em KG credita kg no mesmo SKU (sem composto).
3. No PDV, informe o peso fracionado (ex.: `0,350`).

---

## Cenário 2 — Gelo: caixa R$ 12 → baldes R$ 2 / R$ 3

Caso clássico **caixa → unitário**.

1. **Balde de gelo** (unitário) — estoque real, unidade `UN` (ou `PC`).
   - Dois preços fixos (R$ 2 e R$ 3): cadastre **dois unitários** (ex.: Balde P / Balde G), **ou** um só e altere o preço na venda se for negociação.
2. **Caixa de gelo** (composto):
   - Conversão = `CX` (ou como vier na NF);
   - Itens por composto = baldes por caixa (ex.: `6` → custo implícito R$ 2,00);
   - Vincule ao balde correspondente.
3. **Entrada:** NF da caixa → saldo sobe em **baldes**; custo médio do unitário = custo da caixa ÷ fator.
4. **Venda:** PDV vende o **Balde** (baixa 1 a 1 no unitário).
5. **Inventário:** conte **baldes**, não caixas.

Se a mesma caixa misturar baldes de tamanhos sem fator único: use duas caixas compostas (ou entradas manuais) ligadas cada uma ao balde certo. O sistema **não** reparte uma caixa em dois SKUs automaticamente.

Na entrada por NF: use **Cadastrar caixa + unitário** quando a linha for `CX`/`PCT` sem cadastro.

---

## Cenário 3 — Venda a peso: o sistema já está pronto?

**Veredito: pronto no PDV para quantidade fracionada** (sem balança/etiqueta pesável).

| Camada | Status |
|--------|--------|
| Estoque / movimentos com decimal | Pronto |
| API de venda aceita decimal | Pronto |
| Cadastro `taxUnit` = KG | Pronto |
| PDV quantidade fracionada | **Pronto** — produtos KG/G/L etc. aceitam decimal; ± ajusta 0,1 (ou 1 g/ml) |
| NFC-e `uCom` / `qCom` | Parcial (repassa a qty da venda) |
| Balança / etiqueta pesável | **Não** |

Cadastre o produto com unidade tributável `KG` (preço = R$/kg). No PDV, ao incluir o item, informe o peso (ex.: `0,350`). Releitura do mesmo código **não** soma +1 kg — foque e ajuste a quantidade.

Ainda sem integração com balança serial/USB nem EAN de balança (PLU + peso).

---

## Resumo

| Cenário | Como operar hoje |
|---------|------------------|
| Linguiça kg → unidade | Composto (`KG` + fator) + unitário peça; inventariar peças. Se vende a peso → produto KG (PDV ainda não fraciona). |
| Gelo caixa → baldes | Composto caixa + unitário balde + fator; vender/inventariar balde. Dois preços → dois SKUs (ou preço manual). |
| Venda a peso | PDV aceita qty fracionada (KG/G/L…). Sem balança física. |

Telas relacionadas: **Produtos** (unidade/conversão/composto), **Estoque → Entrada**, **Estoque → Inventário**, **PDV**.
