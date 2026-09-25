# Exemplo prático — chapa em m² + portão (tenant `demo`)

Este roteiro espelha o script `apps/api/scripts/seed-manufacturing-demo-example.ts`.  
Para recriar os dados: `npx ts-node -r tsconfig-paths/register scripts/seed-manufacturing-demo-example.ts` (com `.env` apontando para `gestorvend_tenant_dev`).

## Cenário

- **Bobina/folha 10×10 m** tratada como estoque em **metro quadrado (m²)**, não como “1 bobina”.
- **Portão metálico** consome **2,3 m²** por unidade fabricada.

---

## Passo 1 — Insumo (chapa)

**Menu:** Produtos → **Novo produto**

| Campo | Valor de exemplo |
|--------|------------------|
| Nome | Chapa metal galvanizada |
| Descrição | Estoque em m²; consumo parcial de folha/bobina |
| SKU | `DEMO-CHAPA-M2` |
| Unidade fiscal (aba Fiscal) | **M2** |
| Preço custo | 45,00 (por m²) |
| Estoque mínimo | 1 |

**Fabricação:** deixe *Produto acabado fabricável* **desmarcado**.

**Estoque:** entrada manual ou NF com **100 m²** (no seed já fica 100 m² no local Matriz).

---

## Passo 2 — Produto acabado (portão)

**Produtos → Novo produto**

| Campo | Valor |
|--------|--------|
| Nome | Portão metálico demo |
| SKU | `DEMO-PORTAO-PA` |
| Unidade fiscal | **UN** |
| Preço venda | 2.500,00 |

**Seção Fabricação:**

- Marcar **Produto acabado fabricável**
- Prazo sugerido: **15** dias
- Opcional: **Exibir no catálogo público** (aparece em `/loja/demo`)

> A API só aceita a flag “fabricável” se já existir BOM (passo 3). Orem segura: criar produto → ficha → marcar fabricável (ou rodar o script).

---

## Passo 3 — Ficha técnica (BOM)

**Menu:** **Fábrica → Fichas técnicas** (`/fabrica/fichas-tecnicas`)  
*(Lojas com plano Restaurante também podem usar Salão → Fichas técnicas — é a mesma BOM no banco.)*

1. Buscar **Portão metálico demo**.
2. Adicionar insumo **Chapa metal galvanizada** (SKU `DEMO-CHAPA-M2`).
3. Quantidade **por 1 UN** do portão: **2,3**.
4. Salvar.

Interpretação: cada portão “gasta” 2,3 m² do saldo total de chapa.

---

## Passo 4 — Testar na Fábrica

1. Login tenant **demo** (addon Fábrica + Empresa → Fábrica ativada).
2. **Fábrica → Novo projeto**
   - Cliente qualquer
   - Produto acabado: **Portão metálico demo** / SKU `DEMO-PORTAO-PA`
   - Quantidade **10**
   - **Prazo prometido** preenchido automaticamente (hoje + prazo sugerido do PA, ex. 15 dias) — pode alterar antes de salvar; conferir carga em **Fábrica → Agenda**
3. Avançar fases; na transição para **Início** o sistema reserva/baixa conforme configuração em **Empresa → Fábrica**.
4. **BOM do projeto:** 10 × 2,3 = **23 m²** planejados de chapa.

---

## Catálogo público

http://127.0.0.1:5173/loja/demo — portão demo listado se `showInPublicCatalog` estiver ativo.

---

## Varetas de solda (mesma lógica)

| Cadastro | Unidade | BOM |
|----------|---------|-----|
| Vareta solda | **UN** (1 vareta) | ex.: **1,2 UN** por PA |
| Compra caixa 50 | Conversão **CX-50** ou entrada **50 UN** | — |

Não estoque “1 caixa” se o consumo é por vareta.
