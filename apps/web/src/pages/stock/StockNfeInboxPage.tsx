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

function statusLabel(s: InboxDoc['status']): string {
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

function statusClass(s: InboxDoc['status']): string {
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

/**
 * Caixa de entrada de NF-e descobertas via Distribuição DF-e (NSU) ou busca por chave.
 * O lançamento no estoque exige revisão — abre a Entrada com a chave preenchida.
 */
export function StockNfeInboxPage() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [previewKey, setPreviewKey] = useState<string | null>(null);
  const [pollMsg, setPollMsg] = useState<string | null>(null);

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

  function openInEntrada(accessKey: string) {
    navigate(`/estoque/entrada?chave=${accessKey}`);
  }

  return (
    <div>
      <div
        className="toolbar no-print"
        style={{ display: 'flex', flexWrap: 'wrap', gap: '0.65rem', alignItems: 'center' }}
      >
        <p style={{ margin: 0, flex: 1, fontSize: '0.88rem', color: 'var(--color-text-secondary)' }}>
          NF-e de entrada descobertas automaticamente (polling SEFAZ) ou baixadas por chave. O estoque
          só é lançado após revisão humana quando houver item sem vínculo.
        </p>
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
        <div className={`alert ${poll.isError ? 'alert-error' : 'alert-success'}`} style={{ marginTop: '0.75rem' }}>
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
                <td colSpan={9} className="empty">
                  Carregando…
                </td>
              </tr>
            )}
            {!list.isLoading && !(list.data?.length ?? 0) && (
              <tr>
                <td colSpan={9} className="empty">
                  Nenhuma NF-e pendente. Use &quot;Buscar novas NF-e agora&quot; ou informe a chave em Entrada de
                  produtos.
                </td>
              </tr>
            )}
            {(list.data ?? []).map((doc) => (
              <tr key={doc.id}>
                <td>
                  <span className={statusClass(doc.status)}>{statusLabel(doc.status)}</span>
                </td>
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
                      Revisar e lançar
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
    </div>
  );
}
