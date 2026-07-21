import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { FormModalBackdrop } from '../../components/FormModalBackdrop';
import { api } from '../../lib/api';
import { formatBRL, formatDate } from '../../lib/format';

type InboxDoc = {
  id: string;
  accessKey: string;
  status: 'RESUMO' | 'COMPLETO' | 'PENDENTE_REVISAO' | 'IMPORTADO';
  emitterCnpj: string | null;
  emitterName: string | null;
  documentNumber: string | null;
  issueDate: string | null;
  totalValue: string | null;
  itemCount: number | null;
  unmatchedCount: number | null;
  fetchedAt: string;
  goodsReceiptId: string | null;
  draftReceiptControlNumber?: number | null;
  manifestacaoEvento?: string | null;
};

type InboundFetchResponse = {
  preview: {
    accessKey: string;
    documentNumber: string | null;
    series: string | null;
    issueDate: string | null;
    natureOperation: string | null;
    totalValue: number | null;
    emitter: { cnpj: string; name: string };
    items: Array<{
      lineNumber: number;
      description: string;
      quantity: number;
      unitCost: number;
      supplierCode: string | null;
    }>;
  };
  suggestedMatches: Array<{
    lineNumber: number;
    variantId: string | null;
    label: string | null;
    confidence: string;
  }>;
  supplierId: string | null;
  supplierName: string | null;
  unmatchedCount: number;
  warnings: string[];
  manifested?: boolean;
};

type InboundDiagnostics = {
  ambiente: 'PRODUCAO' | 'HOMOLOGACAO';
  cnpjConsultaMasked: string;
  companyCnpj: string | null;
  companyCnpjMatchesCert: boolean | null;
  certificateConfigured: boolean;
  inboundUltNsu: string | null;
  autoReceipt: { enabled: boolean; postStock: boolean; minMatchPercent: number };
  tips: string[];
  accessKey?: {
    emitCnpj: string;
    number: string;
    serie: string;
    note: string;
  } | null;
};

function statusLabel(s: InboxDoc['status'], draftNo?: number | null): string {
  if (draftNo) return `Rascunho #${draftNo}`;
  switch (s) {
    case 'RESUMO':
      return 'Resumo (aguardando XML)';
    case 'COMPLETO':
      return 'Pronta para lançar';
    case 'PENDENTE_REVISAO':
      return 'Pendente de revisão';
    case 'IMPORTADO':
      return 'Já importada';
    default:
      return s;
  }
}

function statusClass(s: InboxDoc['status'], draftNo?: number | null): string {
  if (draftNo) return 'badge badge-muted';
  switch (s) {
    case 'PENDENTE_REVISAO':
      return 'badge badge-warn';
    case 'COMPLETO':
      return 'badge badge-success';
    case 'RESUMO':
      return 'badge badge-muted';
    default:
      return 'badge';
  }
}

function manifestLabel(tp: string | null | undefined): string {
  switch (tp) {
    case '210200':
      return 'Confirmada';
    case '210210':
      return 'Ciência';
    case '210220':
      return 'Desconhecida';
    case '210240':
      return 'Não realizada';
    default:
      return tp ? tp : '—';
  }
}

/**
 * Caixa de entrada de NF-e descobertas via Distribuição DF-e (NSU) ou busca por chave.
 * O lançamento no estoque exige revisão — abre a Entrada com a chave preenchida —
 * salvo quando a auto-entrada (Empresa → Emissor) criar rascunho/POSTED.
 */
export function StockNfeInboxPage() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [previewKey, setPreviewKey] = useState<string | null>(null);
  const [pollMsg, setPollMsg] = useState<string | null>(null);
  const [diagOpen, setDiagOpen] = useState(false);
  const [diagKey, setDiagKey] = useState('');
  const [justFor, setJustFor] = useState<{ accessKey: string; tpEvento: string } | null>(null);
  const [xJust, setXJust] = useState('');

  const list = useQuery({
    queryKey: ['fiscal', 'inbound', 'documents'],
    queryFn: () => api<InboxDoc[]>('/fiscal/inbound/documents'),
    refetchInterval: 60_000,
  });

  const preview = useQuery({
    queryKey: ['fiscal', 'inbound', 'documents', previewKey],
    queryFn: () => api<InboundFetchResponse>(`/fiscal/inbound/documents/${previewKey}`),
    enabled: Boolean(previewKey),
  });

  const diagnostics = useQuery({
    queryKey: ['fiscal', 'inbound', 'diagnostics', diagKey],
    queryFn: () =>
      api<InboundDiagnostics>(
        `/fiscal/inbound/diagnostics${diagKey.trim() ? `?accessKey=${encodeURIComponent(diagKey.trim())}` : ''}`,
      ),
    enabled: diagOpen,
  });

  const poll = useMutation({
    mutationFn: () =>
      api<{ ingested: number; ultNSU: string | null }>('/fiscal/inbound/poll-nsu', {
        method: 'POST',
        json: {},
      }),
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ['fiscal', 'inbound', 'documents'] });
      setPollMsg(
        data.ingested > 0
          ? `${data.ingested} nova(s) NF-e encontrada(s). Último NSU: ${data.ultNSU ?? '—'}.`
          : `Nenhuma NF-e nova. Último NSU: ${data.ultNSU ?? '—'}.`,
      );
    },
    onError: (e: Error) => setPollMsg(e.message),
  });

  const manifest = useMutation({
    mutationFn: (body: { accessKey: string; tpEvento: string; xJust?: string }) =>
      api<{ cStat: string; nProt?: string; tpEvento: string }>('/fiscal/inbound/manifest', {
        method: 'POST',
        json: body,
      }),
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ['fiscal', 'inbound', 'documents'] });
      setJustFor(null);
      setXJust('');
      setPollMsg(
        `Manifestação ${manifestLabel(data.tpEvento)} registrada (cStat ${data.cStat}` +
          (data.nProt ? `, prot. ${data.nProt}` : '') +
          ').',
      );
    },
    onError: (e: Error) => setPollMsg(e.message),
  });

  function openInEntrada(accessKey: string) {
    navigate(`/estoque/entrada?chave=${accessKey}`);
  }

  function requestManifest(accessKey: string, tpEvento: string) {
    if (tpEvento === '210220' || tpEvento === '210240') {
      setJustFor({ accessKey, tpEvento });
      setXJust('');
      return;
    }
    const labels: Record<string, string> = {
      '210200': 'Confirmação da Operação',
      '210210': 'Ciência da Operação',
    };
    if (
      !window.confirm(
        `Registrar ${labels[tpEvento] ?? tpEvento} na SEFAZ para esta NF-e?`,
      )
    ) {
      return;
    }
    manifest.mutate({ accessKey, tpEvento });
  }

  return (
    <div>
      <div
        className="toolbar no-print"
        style={{ display: 'flex', flexWrap: 'wrap', gap: '0.65rem', alignItems: 'center' }}
      >
        <p style={{ margin: 0, flex: 1, fontSize: '0.88rem', color: 'var(--color-text-secondary)' }}>
          NF-e via webservice oficial (Distribuição DF-e), não scraping do Portal. Se o WS retornar
          cStat 137 e o Portal baixar o XML, use Importar XML na Entrada.
        </p>
        <button type="button" className="btn btn-ghost" onClick={() => setDiagOpen(true)}>
          Diagnóstico WS
        </button>
        <button
          type="button"
          className="btn btn-secondary"
          disabled={poll.isPending}
          onClick={() => {
            setPollMsg(null);
            poll.mutate();
          }}
        >
          {poll.isPending ? 'Consultando SEFAZ…' : 'Buscar novas NF-e agora'}
        </button>
      </div>

      {pollMsg && (
        <div className={`alert ${poll.isError || manifest.isError ? 'alert-error' : 'alert-success'}`} style={{ marginTop: '0.75rem' }}>
          {pollMsg}
        </div>
      )}

      {list.isError && (
        <div className="alert alert-error">{(list.error as Error).message}</div>
      )}

      <div className="table-wrap" style={{ marginTop: '0.75rem' }}>
        <table className="data-table">
          <thead>
            <tr>
              <th>Status</th>
              <th>Manifesto</th>
              <th>Fornecedor</th>
              <th>NF</th>
              <th>Emissão</th>
              <th className="num">Valor</th>
              <th className="num">Itens</th>
              <th className="num">Sem match</th>
              <th>Recebida em</th>
              <th className="col-actions">Ações</th>
            </tr>
          </thead>
          <tbody>
            {list.isLoading && (
              <tr>
                <td colSpan={10} className="empty">
                  Carregando…
                </td>
              </tr>
            )}
            {!list.isLoading && !(list.data?.length ?? 0) && (
              <tr>
                <td colSpan={10} className="empty">
                  Nenhuma NF-e pendente. Use &quot;Buscar novas NF-e agora&quot; ou informe a chave em Entrada de
                  produtos.
                </td>
              </tr>
            )}
            {(list.data ?? []).map((doc) => (
              <tr key={doc.id}>
                <td>
                  <span className={statusClass(doc.status, doc.draftReceiptControlNumber)}>
                    {statusLabel(doc.status, doc.draftReceiptControlNumber)}
                  </span>
                </td>
                <td style={{ fontSize: '0.8rem' }}>{manifestLabel(doc.manifestacaoEvento)}</td>
                <td>
                  <strong>{doc.emitterName ?? '—'}</strong>
                  {doc.emitterCnpj ? (
                    <div style={{ fontSize: '0.78rem', color: 'var(--color-text-muted)' }}>
                      CNPJ {doc.emitterCnpj}
                    </div>
                  ) : null}
                </td>
                <td>{doc.documentNumber ?? '—'}</td>
                <td>{doc.issueDate ? formatDate(doc.issueDate) : '—'}</td>
                <td className="num">
                  {doc.totalValue != null ? formatBRL(Number(doc.totalValue)) : '—'}
                </td>
                <td className="num">{doc.itemCount ?? '—'}</td>
                <td className="num" style={{ color: (doc.unmatchedCount ?? 0) > 0 ? '#b91c1c' : undefined }}>
                  {doc.unmatchedCount ?? '—'}
                </td>
                <td>{formatDate(doc.fetchedAt)}</td>
                <td className="col-actions">
                  <div style={{ display: 'flex', gap: '0.35rem', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                    <button type="button" className="btn btn-secondary btn-compact" onClick={() => setPreviewKey(doc.accessKey)}>
                      Ver
                    </button>
                    <button
                      type="button"
                      className="btn btn-primary btn-compact"
                      disabled={doc.status === 'IMPORTADO' || doc.status === 'RESUMO'}
                      onClick={() => openInEntrada(doc.accessKey)}
                    >
                      {doc.draftReceiptControlNumber ? 'Abrir rascunho' : 'Revisar e lançar'}
                    </button>
                    <button
                      type="button"
                      className="btn btn-ghost btn-compact"
                      disabled={manifest.isPending}
                      title="Confirmação da Operação (210200)"
                      onClick={() => requestManifest(doc.accessKey, '210200')}
                    >
                      Confirmar
                    </button>
                    <button
                      type="button"
                      className="btn btn-ghost btn-compact"
                      disabled={manifest.isPending}
                      title="Desconhecimento (210220)"
                      onClick={() => requestManifest(doc.accessKey, '210220')}
                    >
                      Desconhecer
                    </button>
                    <button
                      type="button"
                      className="btn btn-ghost btn-compact"
                      disabled={manifest.isPending}
                      title="Operação não realizada (210240)"
                      onClick={() => requestManifest(doc.accessKey, '210240')}
                    >
                      Não realizada
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {previewKey && (
        <FormModalBackdrop className="modal-backdrop--wide" onClose={() => setPreviewKey(null)}>
          <div className="modal modal--wide" role="dialog" aria-labelledby="nfe-inbox-preview-title">
            <h2 id="nfe-inbox-preview-title">Prévia da NF-e</h2>
            <p style={{ margin: '0 0 0.75rem', fontSize: '0.82rem', color: 'var(--color-text-muted)', wordBreak: 'break-all' }}>
              Chave: {previewKey}
            </p>
            {preview.isLoading && <p>Carregando…</p>}
            {preview.isError && (
              <div className="alert alert-error">{(preview.error as Error).message}</div>
            )}
            {preview.data && (
              <>
                <p style={{ margin: '0 0 0.5rem' }}>
                  <strong>{preview.data.preview.emitter.name}</strong>
                  {' · '}
                  NF {preview.data.preview.documentNumber ?? '—'}
                  {preview.data.preview.totalValue != null
                    ? ` · ${formatBRL(preview.data.preview.totalValue)}`
                    : ''}
                </p>
                {(preview.data.warnings ?? []).map((w) => (
                  <div key={w} className="alert alert-error" style={{ fontSize: '0.85rem' }}>
                    {w}
                  </div>
                ))}
                <div className="table-wrap">
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th className="num">#</th>
                        <th>Descrição</th>
                        <th>Match</th>
                        <th className="num">Qtd</th>
                        <th className="num">Custo</th>
                      </tr>
                    </thead>
                    <tbody>
                      {preview.data.preview.items.map((item) => {
                        const match = preview.data!.suggestedMatches.find(
                          (m) => m.lineNumber === item.lineNumber,
                        );
                        return (
                          <tr key={item.lineNumber}>
                            <td className="num">{item.lineNumber}</td>
                            <td>
                              {item.description}
                              {item.supplierCode ? (
                                <div style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)' }}>
                                  cProd {item.supplierCode}
                                </div>
                              ) : null}
                            </td>
                            <td>
                              {match?.variantId ? (
                                <span className="badge badge-success">{match.label}</span>
                              ) : (
                                <span className="badge badge-warn">Sem vínculo</span>
                              )}
                            </td>
                            <td className="num">{item.quantity.toLocaleString('pt-BR')}</td>
                            <td className="num">{formatBRL(item.unitCost)}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </>
            )}
            <div className="modal-actions">
              <button type="button" className="btn btn-secondary" onClick={() => setPreviewKey(null)}>
                Fechar
              </button>
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => {
                  const key = previewKey;
                  setPreviewKey(null);
                  openInEntrada(key);
                }}
              >
                Revisar e lançar
              </button>
            </div>
          </div>
        </FormModalBackdrop>
      )}

      {diagOpen && (
        <FormModalBackdrop onClose={() => setDiagOpen(false)}>
          <div className="modal" role="dialog" aria-labelledby="nfe-diag-title">
            <h2 id="nfe-diag-title">Diagnóstico WS × Portal</h2>
            <p className="muted" style={{ fontSize: '0.85rem' }}>
              O Portal Nacional é a interface humana; a entrada automática usa o webservice
              NFeDistribuicaoDFe com o certificado A1.
            </p>
            <div className="field">
              <label htmlFor="diag-key">Chave NF-e (opcional)</label>
              <input
                id="diag-key"
                value={diagKey}
                onChange={(e) => setDiagKey(e.target.value.replace(/\D/g, '').slice(0, 44))}
                placeholder="44 dígitos para analisar emitente"
                inputMode="numeric"
              />
            </div>
            <button
              type="button"
              className="btn btn-secondary"
              style={{ marginBottom: '0.75rem' }}
              onClick={() => qc.invalidateQueries({ queryKey: ['fiscal', 'inbound', 'diagnostics'] })}
            >
              Atualizar
            </button>
            {diagnostics.isLoading && <p>Carregando…</p>}
            {diagnostics.isError && (
              <div className="alert alert-error">{(diagnostics.error as Error).message}</div>
            )}
            {diagnostics.data && (
              <>
                <ul style={{ margin: '0 0 0.75rem', paddingLeft: '1.1rem', fontSize: '0.88rem' }}>
                  <li>
                    Ambiente: <strong>{diagnostics.data.ambiente}</strong>
                  </li>
                  <li>
                    CNPJ consulta (cert): <strong>{diagnostics.data.cnpjConsultaMasked}</strong>
                    {diagnostics.data.companyCnpjMatchesCert === false
                      ? ' — difere do CNPJ da empresa'
                      : ''}
                  </li>
                  <li>
                    Certificado A1:{' '}
                    {diagnostics.data.certificateConfigured ? 'configurado' : 'faltando'}
                  </li>
                  <li>
                    Último NSU: <code>{diagnostics.data.inboundUltNsu ?? '0'}</code>
                  </li>
                  <li>
                    Auto-entrada:{' '}
                    {diagnostics.data.autoReceipt.enabled
                      ? `ligada (${diagnostics.data.autoReceipt.postStock ? 'POSTED' : 'DRAFT'}, match ≥ ${diagnostics.data.autoReceipt.minMatchPercent}%)`
                      : 'desligada'}
                  </li>
                </ul>
                {diagnostics.data.accessKey && (
                  <p style={{ fontSize: '0.85rem' }}>
                    Emitente na chave: CNPJ {diagnostics.data.accessKey.emitCnpj} · NF{' '}
                    {diagnostics.data.accessKey.number}/{diagnostics.data.accessKey.serie}
                    <br />
                    <span className="muted">{diagnostics.data.accessKey.note}</span>
                  </p>
                )}
                <div className="alert alert-success" style={{ fontSize: '0.85rem' }}>
                  <strong>Dicas</strong>
                  <ul style={{ margin: '0.35rem 0 0', paddingLeft: '1.1rem' }}>
                    {diagnostics.data.tips.map((t) => (
                      <li key={t}>{t}</li>
                    ))}
                  </ul>
                </div>
              </>
            )}
            <div className="modal-actions">
              <button type="button" className="btn btn-secondary" onClick={() => setDiagOpen(false)}>
                Fechar
              </button>
            </div>
          </div>
        </FormModalBackdrop>
      )}

      {justFor && (
        <FormModalBackdrop onClose={() => setJustFor(null)}>
          <div className="modal" role="dialog" aria-labelledby="nfe-just-title">
            <h2 id="nfe-just-title">
              {justFor.tpEvento === '210220' ? 'Desconhecimento' : 'Operação não realizada'}
            </h2>
            <p className="muted" style={{ fontSize: '0.85rem' }}>
              Informe a justificativa (mínimo 15 caracteres) exigida pela SEFAZ.
            </p>
            <div className="field">
              <label htmlFor="xjust">Justificativa</label>
              <textarea
                id="xjust"
                rows={3}
                value={xJust}
                onChange={(e) => setXJust(e.target.value)}
                maxLength={255}
              />
            </div>
            <div className="modal-actions">
              <button type="button" className="btn btn-secondary" onClick={() => setJustFor(null)}>
                Cancelar
              </button>
              <button
                type="button"
                className="btn btn-primary"
                disabled={manifest.isPending || xJust.trim().length < 15}
                onClick={() =>
                  manifest.mutate({
                    accessKey: justFor.accessKey,
                    tpEvento: justFor.tpEvento,
                    xJust: xJust.trim(),
                  })
                }
              >
                {manifest.isPending ? 'Enviando…' : 'Enviar à SEFAZ'}
              </button>
            </div>
          </div>
        </FormModalBackdrop>
      )}
    </div>
  );
}
