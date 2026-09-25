# Módulo Fábrica — fabricação de produto acabado

Documento mestre de requisitos e operação do addon **Fábrica** no GestorVend.

## 1. Visão

Gerenciar **projetos de fabricação** de produtos acabados (PA) cadastrados em **Produtos**, com ficha técnica (BOM), fases de produção (kanban), reserva e consumo de insumos **por fase**, e entrada de estoque do PA ao finalizar.

Não substitui **Ordem de Serviços** (reparo/equipamento); reutiliza padrões de UX e de estoque.

## 2. Glossário

| Termo | Significado |
|-------|-------------|
| PA | Produto acabado fabricado |
| BOM | Bill of Materials — ficha técnica (`ProductRecipe`) |
| Projeto | Registro `ManufacturingProject` |
| Reserva | Quantidade bloqueada na disponibilidade, sem baixa física |
| Baixa / issue | Saída física de estoque (`StockMovement` OUT) |
| Backflush | Baixa automática do saldo BOM ainda não consumido |
| Lead | Contato do catálogo público antes de virar projeto formal |

## 3. Atores

- **Cliente** — solicita orçamento (catálogo, WhatsApp, Instagram).
- **Comercial** — cliente, prazo, valor (`quoteTotal`), aprovação.
- **Responsável técnico** — especificação, BOM, fases técnicas.
- **Produção** — avanço de fase, baixas manuais quando permitido.
- **Financeiro** — depósitos/vendas (ondas futuras).
- **Gerente** — cancelamento com estorno, recálculo de BOM.

## 4. Fases e campos obrigatórios

| Fase | Código | Campos mínimos |
|------|--------|----------------|
| Escolha do produto | `PRODUCT_SELECTION` | Cliente, PA (`finishedVariantId`), quantidade |
| Orçamento | `QUOTE` | BOM calculada, `quoteTotal`, `promisedAt` |
| Início | `STARTED` | Reservas confirmadas; responsável técnico |
| Em desenvolvimento | `IN_DEVELOPMENT` | Apontamentos / baixas parciais |

### Apontamentos e insumos adicionais (perda / mau uso)

- **Nota ao mudar fase**: ao avançar ou cancelar, informe texto opcional — gravado em `ManufacturingStatusLog` junto com `fromStatus` → `toStatus`.
- **Apontamento sem mudar fase**: `POST /manufacturing/projects/:id/apontamentos` com `{ "note": "…" }`. Aparece no histórico com fase **Apontamento** (mesmo status de origem e destino).
- **Insumo adicional na BOM**: `POST /manufacturing/projects/:id/bom-additional` com:
  - `ingredientVariantId` — SKU do insumo (pode ser linha já existente ou insumo novo no projeto)
  - `quantity` — quantidade **extra** a somar no planejado
  - `reason` — opcional (perda, quebra, retrabalho)
  - `issueNow` — se `true`, faz baixa física imediata da quantidade extra (além de atualizar o planejado)
- Se o projeto já tiver **reservas ativas** (após QUOTE → STARTED), o sistema tenta aumentar a reserva proporcional (planejado + scrap %). Sem estoque disponível, a API recusa.
- Na UI: detalhe do projeto → seções **Apontamento** e **Insumo adicional (perda / retrabalho)**.
| Testes | `TESTING` | Checklist QA (`qualityNotes`) |
| Produto finalizado | `FINISHED` | Entrada PA; encerramento |
| Cancelado | `CANCELLED` | Motivo |

## 5. Regras de estoque (por fase)

Configuração em **Empresa → Fábrica**:

- `factoryIssuePctAtStart` — % do BOM baixado ao entrar em **Início**
- `factoryIssuePctDevelopment` — % adicional ao entrar em **Em desenvolvimento**
- Insumos com `issueAtStart` na linha BOM baixam 100% na fase Início

Fluxo:

1. **QUOTE → STARTED**: criar reservas; aplicar baixa de Início.
2. **→ IN_DEVELOPMENT**: baixa parcial conforme % configurada (sobre saldo planejado − já baixado).
3. **→ TESTING**: opcional baixa manual via API.
4. **→ FINISHED**: backflush remanescente + **entrada** do PA (`StockMovementSource.MANUFACTURING` IN).
5. **CANCELLED**: liberar reservas; estorno de baixas exige perfil gerente (v1.1).

Disponibilidade: `saldo − reservas_ativas` antes de reservar.

### Prazo prometido e agenda

- **`manufacturingLeadTimeDays`** no cadastro do PA sugere **`promisedAt`** ao abrir um novo projeto (dias corridos a partir de hoje); o usuário pode ajustar conforme a capacidade da fábrica.
- **Fábrica → Agenda** (`/fabrica/agenda`): calendário (dia/semana/mês) agrupa projetos pela data de entrega prometida; **Linha do tempo** exibe trechos por fase a partir de `ManufacturingStatusLog`, com marcador do prazo prometido.
- API: `GET /manufacturing/projects/schedule?from=&to=` (intervalo inclusivo `YYYY-MM-DD`).

## 6. Integrações

- **Produtos**: flags `isManufacturedFinishedGood`, `showInPublicCatalog`, BOM obrigatória se PA.
- **Estoque**: movimentos OUT/IN rastreados por `MF:{número}`.
- **Vendas**: `saleId` / depósito (onda 4).
- **Portal**: addon `FACTORY` em `TenantModuleGrant`.

## 7. Catálogo público e WhatsApp

- Rota web: `/loja/:tenantSlug`
- API pública: `GET /manufacturing/public/catalog`, `POST /manufacturing/public/leads`
- Link direto: `wa.me` com mensagem configurável (Empresa → Fábrica → Catálogo público)
- Instagram: landing (`?utm=instagram`)

### Configuração por produto (checklist)

1. **Produtos → alterar**
   - Marcar **Produto acabado fabricável** e **Exibir no catálogo público**.
   - Preencher **nome**, **descrição** (loja + bot ao escolher o item) e **prazo sugerido (dias)**.
   - Garantir **pelo menos uma variante** com preço — produtos sem variante **não entram** no bot (`getCatalog` filtra só com `variantId`).
2. **Aba Imagem** (após salvar): enviar PNG/JPEG/WebP (até 2 MB). Exibida na loja e enviada no WhatsApp ao escolher o modelo (requer `PUBLIC_API_BASE_URL` na API).
3. Ordem na loja/bot: alfabética por nome (máx. 200 PAs publicados).

### Configuração na Empresa (checklist)

1. **Telefone** da empresa — usado no `wa.me` da loja.
2. **Fábrica → Catálogo público**: template da mensagem WhatsApp na loja (`{codigo}`, `{nome}`).
3. **Fábrica → Bot WhatsApp**: credenciais Meta; opcionalmente textos de boas-vindas, menu e mensagem pós-confirmação (`{numero}` = nº do projeto).
4. **Termos no orçamento** — só impressão PDF, não o bot.
5. Plano **WHATSAPP** + addon **FÁBRICA** no portal.

### Validação antes de divulgar

- Abrir `/loja/{tenantSlug}` e conferir fotos, descrições e botão WhatsApp.
- Testar bot: `POST /api/wachat/factory/inbound` (ver WACHAT-FACTORY) ou conversa no número Meta.
- Conferir que cada PA publicado tem variante/preço; caso contrário some só do bot, não da API bruta.

### Bot WhatsApp (Fábrica)

Documentação completa: **[WACHAT-FACTORY.md](./WACHAT-FACTORY.md)**.

- Conversa e webhook Meta na **API GestorVend** (`/api/webhooks/whatsapp/factory`); configuração em **Empresa → Fábrica**.
- Bridge opcional: `GET/POST /wachat/factory/*` e `POST /wachat/factory/inbound` (testes com `X-WaChat-Key`).
- Fluxo: catálogo → escolha (foto + descrição se cadastrados) → lead `ManufacturingProject` → handoff; consultor envia PDF manualmente.
- `externalRef` idempotente (`wa:…`) evita projetos duplicados.

## 8. Roadmap

| Onda | Entrega |
|------|---------|
| 1 | CRUD, fases, log, UI kanban/lista, licença |
| 2 | Reservas, baixas por fase, entrada PA; **UI** detalhe (PATCH, BOM, baixa manual) |
| 3 | Catálogo + leads |
| 4 | Orçamento PDF (`/fabrica/impressao`), depósito PDV (**PDV — registrar sinal** coloca o valor previsto no carrinho, sem baixa de estoque; vincula `depositSaleId` ao finalizar) |
| 5 | MRP simplificado (`/fabrica/mrp`), local de estoque da fábrica (Empresa); **bot WhatsApp Fábrica** (bridge + GestorVendChat); lotes pendentes de ICP |

### Operação (backoffice)

- **Projetos**: filtro por origem (`source`), banner de alertas (`GET /manufacturing/alerts`).
- **Empresa → Fábrica**: `factoryStockLocationId` opcional para reservas/baixas/entrada PA.

## 9. Escopo enterprise (fora do produto atual)

Não está no roadmap do GestorVend job shop, salvo decisão explícita de produto:

- **Roteiro de produção** (lista de operações, tempos padrão, sequência).
- **Centros de trabalho** e **capacidade finita** (APS).
- **MES / chão de fábrica**: terminal operador, código de barras, apontamento de horas, instruções digitais.
- **Custo industrial** (padrão vs. real, variância, backflush contábil).
- **Lote/série** e rastreabilidade regulatória.

Integrações ERP↔chão e quality gates estruturados (NCR, checklist) ficam documentados aqui como referência de mercado, não como compromisso de entrega.

## 10. Referências (boas práticas)

- Fabricação discreta com explosão de BOM (ERP clássico).
- ATP — Available to Promise (reserva vs. baixa).
- Quality gate na fase Testes.
- Audit trail: `ManufacturingStatusLog` + `UserActivityLog`.
