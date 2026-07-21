# Homologação NFC-e / NF-e — emissão (API + Empresa + PDV)

Guia mínimo para validar o fluxo de **saída** no GestorVend: fila (`FiscalDocument`), worker com XML/assinatura A1, modo **dry-run** e modo **soap** (SEFAZ real).

> **Escopo do worker:** NFC-e (**65**) e NF-e (**55**). XML de ICMS nesta versão: **CRT = 1 (Simples Nacional)** com CSOSN. Endereço do emitente usa número `S/N` e bairro `CENTRO` se o cadastro da empresa não detalhar. URLs SOAP padrão são **SVRS** — confirme no manual da sua UF.

---

## 1. Servidor da API (`.env`)

| Variável | Função |
|----------|--------|
| `FISCAL_MODULE_ENABLED=true` | Liga o worker (~60 s) nos tenants **READY**. |
| `FISCAL_EMIT_TRANSPORT=dry-run` | Monta/assina XML e autoriza com `protocol: DRY-RUN` **sem** POST. |
| `FISCAL_EMIT_TRANSPORT=soap` | Envio real (mTLS A1) ao NFeAutorizacao4. |

Fallback global (se o tenant não preencher na UI):

| Variável | Uso |
|----------|-----|
| `FISCAL_ISSUER_CERT_PATH` / `FISCAL_ISSUER_CERT_PASSWORD` | `.pfx` no disco da API |
| `FISCAL_NFCE_CSC_ID` / `FISCAL_NFCE_CSC` | CSC (obrigatório para NFC-e em SOAP) |
| `FISCAL_SEFAZ_NFCE_SOAP_URL` | Autorização NFC-e |
| `FISCAL_SEFAZ_NFE_SOAP_URL` | Autorização NF-e 55 |
| `FISCAL_SEFAZ_INUTILIZACAO_URL` | Inutilização (opcional) |
| `FISCAL_NFCE_QR_BASE_URL` | Base do QR-code |
| `NFE_OUTBOUND_DIR` | Pasta dos XMLs autorizados (`nfeProc`) |

O `.pfx` precisa existir **na máquina onde roda o Node**.

---

## 2. Tela Empresa (`/empresa`)

1. CNPJ, razão, fantasia, IE, CEP, município IBGE, UF.
2. PDV: **Planejamento para documento fiscal (NF-e/NFC-e)**.
3. Emissor: ambiente Homologação, série/números, **CRT = 1**, caminho/senha A1, CSC (NFC-e).

---

## 3. Produtos e PDV

- Itens com **Situação fiscal** (CFOP/CSOSN/NCM).
- Venda concluída.
- Histórico do PDV: **Enfileirar NFC-e** ou **Enfileirar NF-e** (NF-e exige cliente com CPF/CNPJ).

---

## 4. Worker e contingência

1. Com `FISCAL_MODULE_ENABLED=true`, em até ~1 min o status vira `AUTHORIZED` (dry-run) ou consulta SEFAZ (soap).
2. Falha de comunicação em NFC-e → `CONTINGENCY` (XML assinado guardado; número **não** consumido até autorizar).
3. Em **Notas Fiscais**: **Enviar SEFAZ** retransmite o **mesmo** XML/chave.
4. Cancelamento (autorizada + soap): evento 110111. Inutilização: botão na tela Notas Fiscais → `POST /fiscal/documents/inutilizar`.

---

## 5. Checklist rápido

- [ ] `FISCAL_MODULE_ENABLED=true`
- [ ] dry-run OK → depois `FISCAL_EMIT_TRANSPORT=soap`
- [ ] Certificado A1 + CSC (NFC-e) no emissor ou `.env`
- [ ] URL SOAP da UF (se não for SVRS)
- [ ] Empresa em modo fiscal planejado
- [ ] Homologação antes de produção
