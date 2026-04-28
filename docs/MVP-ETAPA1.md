# MVP — Etapa 1 (GestorVend)

## Objetivo do MVP

Entregar um núcleo operacional utilizável em loja piloto: **cadastros essenciais**, **estoque com movimentos**, **PDV com baixa de estoque**, **caixa vinculado ao PDV**, **contas a pagar/receber básicas** e **relatórios mínimos** com exportação. Itens avançados ficam em fases subsequentes dentro da Etapa 1.

## Incluído no MVP

| Área | Escopo |
|------|--------|
| **Multi-tenant** | Banco central (CNPJ/licença) + um banco PostgreSQL por tenant; resolução por header `X-Tenant-Id` ou subdomínio (preparado na API). |
| **Auth** | JWT (access + refresh), RBAC por perfis (admin, gerente, vendedor, financeiro). |
| **Clientes / Fornecedores** | CRUD com CPF/CNPJ, contatos, endereço; histórico de vendas vinculado ao cliente na venda. |
| **Produtos** | Categorias hierárquicas, produto com variações (SKU), código de barras, preço varejo/atacado; NCM/CEST opcionais (gancho fiscal). |
| **Estoque** | Locais, saldo por produto/variação/local, movimentos (entrada/saída/ajuste/transferência), custo médio. |
| **Vendas / PDV** | Venda com múltiplos itens, desconto, formas de pagamento, número sequencial, vínculo opcional a cliente; cancelamento com permissão (role). |
| **Caixa** | Abertura/fechamento por usuário, sangria/suprimento, conciliação por forma de pagamento. |
| **Financeiro** | Contas a pagar e a receber com parcelas, baixa manual; integração: venda a prazo gera contas a receber. |
| **Relatórios** | Vendas por período, posição de estoque, export CSV (PDF em fase seguinte). |

## Fora do MVP (fases seguintes na Etapa 1)

- Inventário físico completo com contagem cega, curva ABC, RFV completo.
- Conciliação bancária automática, lembretes de cobrança por e-mail.
- Modo offline PDV + sync.
- App mobile nativo.
- Dashboard executivo avançado e KPIs completos.
- Personalização de layouts de impressão e envio WhatsApp.

## Etapa 2 (fora do escopo do MVP)

NF-e, NFC-e, SPED, integração SEFAZ, certificado A1 — módulo fiscal separado e desabilitado por padrão até homologação.
