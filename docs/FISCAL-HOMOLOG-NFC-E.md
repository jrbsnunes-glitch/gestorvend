# Primeiro teste de NFC-e — homologação (API + tela Empresa)

Guia mínimo para validar o fluxo já implementado no GestorVend: fila local (`FiscalDocument`), worker com XML/assinatura A1, modo **dry-run** (sem SEFAZ) e modo **soap** (envio real em homologação).

> **Limites atuais do worker:** só **NFC-e (modelo 65)**; **NF-e 55** não é processada; no XML o worker aceita **CRT = 1 (Simples Nacional)**. Ajuste CRT na tela, mas evite emitir com regime divergente até o XML ICMS normal existir.

---

## 1. Servidor da API (`apps/api/.env` ou `.env` na raiz)

| Variável | Função |
|----------|--------|
| `FISCAL_MODULE_ENABLED=true` | Liga o worker que roda aproximadamente a cada **60 segundos** nos tenants **READY**. Sem isso nada é processado. |
| `FISCAL_EMIT_TRANSPORT=dry-run` | **Recomendado primeiro:** monta XML, assina, gera chave e marca documento como autorizado com `protocol: DRY-RUN`, **sem** POST à SEFAZ. |
| `FISCAL_EMIT_TRANSPORT=soap` | Envio **real** ao endpoint SOAP de autorização NFC-e (homologação ou produção conforme cadastro do emissor). |

Para **SOAP**, é obrigatório que existam **certificado usável no servidor** e **CSC completo** (ID + segredo/token), seja pela **tela Empresa → Emissor NFC-e**, seja por fallback no ambiente:

| Variável (fallback global) | Quando usar |
|----------------------------|-------------|
| `FISCAL_ISSUER_CERT_PATH` | Caminho absoluto ao `.pfx` quando não preencher `certificatePath` no tenant. |
| `FISCAL_ISSUER_CERT_PASSWORD` | Senha do `.pfx` quando não gravar na base via UI. |
| `FISCAL_NFCE_CSC_ID` | ID do CSC quando não gravar na base. |
| `FISCAL_NFCE_CSC` | Token/segredo CSC quando não gravar na base. |

Opcionais:

| Variável | Função |
|----------|--------|
| `FISCAL_SEFAZ_NFCE_SOAP_URL` | URL do **NfeAutorizacao4**. Se vazio, a API usa um endpoint de homologação SVRS (RS) como padrão — **confirme no manual da sua UF/Sefaz**. |
| `FISCAL_NFCE_QR_BASE_URL` | URL base da **consulta pública NFC-e** usada no QR-code (ex.: SP homolog). Ajuste conforme estado e ambiente. |

**Certificado:** o arquivo `.pfx` precisa estar **no disco da máquina onde roda o Node** (mesmo caminho informado na UI ou em `FISCAL_ISSUER_CERT_PATH`). Em VPS, copie com permissões restritas ao usuário do serviço.

---

## 2. Tela **Empresa** (`/empresa`)

Acesso: perfil **Gerente** (ou perfil com permissão equivalente ao cadastro da empresa).

### 2.1 Identificação e endereço

Preencha dados coerentes com o emitente no certificado:

- **CNPJ** válido (14 dígitos úteis).
- **Razão social** e **fantasia** (entraram no XML como emitente).
- **Inscrição estadual** quando aplicável.
- **CEP** numérico (usado no XML).

Salve com **Salvar alterações**.

### 2.2 PDV — documento da venda

Marque **“Planejamento para documento fiscal (NF-e/NFC-e)”** e salve. Sem isso, `POST /fiscal/documents/queue` retorna erro (modo só comprovante não fiscal).

### 2.3 Emissor NFC-e (servidor)

1. **Ambiente SEFAZ:** **Homologação** até concluir todos os testes.
2. **UF emissor:** duas letras (ex.: `SP`).
3. **IBGE município:** 7 dígitos do município do **emitente** (mesmo usado na credenciamento NFC-e).
4. **Série NFC-e** e número já evoluem no worker (`nfceLastNumber` é exibido como referência).
5. **CRT:** use **1 — Simples Nacional** para compatibilidade com o worker atual.
6. **Caminho absoluto do .pfx no servidor** e **senha**, ou deixe caminho/senha só no `.env` como fallback.
7. **CSC ID** e **token CSC** (portal estadual) — obrigatórios para **SOAP** e para o QR válido.

Clique em **Salvar emissor NFC-e**.

A linha de status (“senha OK”, “caminho OK”, “ID/token CSC”) confirma se há combinação base + `.env` suficiente para transmitir.

---

## 3. Produtos e PDV

- Cada item da venda deve estar amarrado a **Situação fiscal** com **CFOP/CSOSN/NCM** razoáveis (`/cadastros/situacao-fiscal` e cadastro de produtos).
- Conclua uma **venda** no PDV.

---

## 4. Enfileirar documento

Com o módulo ligado e empresa em modo fiscal planejado:

1. No PDV (**Vendas**), use a ação que chama `POST /fiscal/documents/queue` (ou equivalente na sua build), **ou** envie manualmente:
   - `POST /api/fiscal/documents/queue` com `{ "saleId": "<uuid>", "kind": "NFC_E" }` (Bearer do tenant).

2. Aguarde até **~1 minuto** ou o próximo ciclo do worker.

3. Verifique o estado do `FiscalDocument` (via API `GET /fiscal/documents/sale/:saleId` ou UI da venda):
   - **dry-run:** `AUTHORIZED`, `protocol: DRY-RUN`.
   - **soap homolog:** `AUTHORIZED` com protocolo/rejeição conforme retorno SEFAZ; em erro, leia `lastError` e `fiscalIntegrationError` na venda.

---

## 5. Ordem sugerida de testes

1. `FISCAL_MODULE_ENABLED=true` + `FISCAL_EMIT_TRANSPORT=dry-run` + cadastro empresa/emissor → enfileirar → confirmar **DRY-RUN**.
2. Ajustar `FISCAL_SEFAZ_NFCE_SOAP_URL` (e QR, se preciso) para o **mesmo estado/ambiente** do certificado.
3. Trocar para `FISCAL_EMIT_TRANSPORT=soap`, manter **Homologação** no emissor → enfileirar de novo (ou reenfileirar) → analisar **autorização ou motivo de rejeição** no log da API.

---

## 6. Produção

- Troque **Ambiente** do emissor para **Produção** **somente** após homologação estável.
- Use URLs **de produção** do webservice e da consulta QR.
- Proteja `.pfx`, CSC e backups; revise permissões em disco e segredos no painel da hospedagem.

---

## Referência no código

- Worker e transporte: `apps/api/src/fiscal/fiscal-emission.processor.ts`
- Fila: `apps/api/src/fiscal/fiscal-documents.service.ts`
- Variáveis: `.env.example` na raiz do repositório
