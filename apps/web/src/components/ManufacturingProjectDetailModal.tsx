import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { FormCadastroModal } from './FormCadastroModal';
import { FormModalBackdrop } from './FormModalBackdrop';
import { ManufacturingStatusChip } from './ManufacturingStatusChip';
import { api } from '../lib/api';
import { formatBRL } from '../lib/format';
import {
  MFG_SOURCE_LABEL,
  MFG_STATUS_LABEL,
  NEXT_MFG_STATUS,
  type MfgStatus,
} from '../lib/manufacturing-labels';
import type { MfgProjectDetail } from '../lib/manufacturing-types';

function formatDateTime(iso: string) {
  return new Date(iso).toLocaleString('pt-BR');
}

type Assignee = { id: string; name: string };

type ProductHit = {
  productId: string;
  productName: string;
  variantId: string;
  sku: string;
};

const CLOSED: MfgStatus[] = ['FINISHED', 'CANCELLED'];

function isStatusApontamento(from: MfgStatus | null, to: MfgStatus) {
  return from != null && from === to;
}

function canEdit(status: MfgStatus) {
  return !CLOSED.includes(status);
}

export function ManufacturingProjectDetailModal({
  projectId,
  onClose,
}: {
  projectId: string;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const [formErr, setFormErr] = useState<string | null>(null);
  const [issueQty, setIssueQty] = useState<Record<string, string>>({});
  const [depositSaleId, setDepositSaleId] = useState('');
  const [statusNote, setStatusNote] = useState('');
  const [apontamentoNote, setApontamentoNote] = useState('');
  const [extraIngQ, setExtraIngQ] = useState('');
  const [extraIng, setExtraIng] = useState<ProductHit | null>(null);
  const [extraQty, setExtraQty] = useState('');
  const [extraReason, setExtraReason] = useState('');
  const [extraIssueNow, setExtraIssueNow] = useState(true);

  const detailQ = useQuery({
    queryKey: ['manufacturing', 'detail', projectId],
    queryFn: () => api<MfgProjectDetail>(`/manufacturing/projects/${projectId}`),
    enabled: Boolean(projectId),
    staleTime: 0,
    refetchOnMount: 'always',
  });

  const assigneesQ = useQuery({
    queryKey: ['manufacturing', 'assignees'],
    queryFn: () => api<Assignee[]>('/manufacturing/assignees'),
  });

  const extraIngSearchQ = useQuery({
    queryKey: ['products', 'search', extraIngQ],
    queryFn: () => api<ProductHit[]>(`/products/search?q=${encodeURIComponent(extraIngQ.trim())}`),
    enabled: extraIngQ.trim().length >= 2,
  });

  const [edit, setEdit] = useState({
    title: '',
    quantity: '',
    promisedAt: '',
    quoteTotal: '',
    depositAmount: '',
    customerBrief: '',
    technicalSpec: '',
    deliveryNotes: '',
    internalNotes: '',
    qualityNotes: '',
    technicalResponsibleId: '',
    commercialResponsibleId: '',
  });

  useEffect(() => {
    const d = detailQ.data;
    if (!d) return;
    setEdit({
      title: d.title ?? '',
      quantity: d.quantity,
      promisedAt: d.promisedAt ? d.promisedAt.slice(0, 10) : '',
      quoteTotal: d.quoteTotal ?? '',
      depositAmount: d.depositAmount ?? '',
      customerBrief: d.customerBrief ?? '',
      technicalSpec: d.technicalSpec ?? '',
      deliveryNotes: d.deliveryNotes ?? '',
      internalNotes: d.internalNotes ?? '',
      qualityNotes: d.qualityNotes ?? '',
      technicalResponsibleId: d.technicalResponsible?.id ?? '',
      commercialResponsibleId: d.commercialResponsible?.id ?? '',
    });
  }, [detailQ.data]);

  function invalidateDetail() {
    void qc.invalidateQueries({ queryKey: ['manufacturing'] });
    void qc.invalidateQueries({ queryKey: ['manufacturing', 'detail', projectId] });
  }

  const patchMut = useMutation({
    mutationFn: () =>
      api<MfgProjectDetail>(`/manufacturing/projects/${projectId}`, {
        method: 'PATCH',
        json: {
          title: edit.title.trim() || null,
          quantity: edit.quantity,
          promisedAt: edit.promisedAt || null,
          quoteTotal: edit.quoteTotal.trim() ? edit.quoteTotal : null,
          depositAmount: edit.depositAmount.trim() ? edit.depositAmount : '0',
          customerBrief: edit.customerBrief.trim() || null,
          technicalSpec: edit.technicalSpec.trim() || null,
          deliveryNotes: edit.deliveryNotes.trim() || null,
          internalNotes: edit.internalNotes.trim() || null,
          qualityNotes: edit.qualityNotes.trim() || null,
          technicalResponsibleId: edit.technicalResponsibleId || null,
          commercialResponsibleId: edit.commercialResponsibleId || null,
        },
      }),
    onSuccess: () => {
      setFormErr(null);
      invalidateDetail();
    },
    onError: (e: Error) => setFormErr(e.message),
  });

  const statusMut = useMutation({
    mutationFn: ({ status, note }: { status: MfgStatus; note?: string }) =>
      api(`/manufacturing/projects/${projectId}/status`, {
        method: 'POST',
        json: {
          status,
          ...(note?.trim() ? { note: note.trim() } : {}),
        },
      }),
    onSuccess: () => {
      setStatusNote('');
      invalidateDetail();
    },
  });

  const apontamentoMut = useMutation({
    mutationFn: (note: string) =>
      api<MfgProjectDetail>(`/manufacturing/projects/${projectId}/apontamentos`, {
        method: 'POST',
        json: { note },
      }),
    onSuccess: () => {
      setApontamentoNote('');
      setFormErr(null);
      invalidateDetail();
    },
    onError: (e: Error) => setFormErr(e.message),
  });

  const extraBomMut = useMutation({
    mutationFn: () =>
      api<MfgProjectDetail>(`/manufacturing/projects/${projectId}/bom-additional`, {
        method: 'POST',
        json: {
          ingredientVariantId: extraIng!.variantId,
          quantity: extraQty.trim(),
          reason: extraReason.trim() || null,
          issueNow: extraIssueNow,
        },
      }),
    onSuccess: () => {
      setExtraIng(null);
      setExtraIngQ('');
      setExtraQty('');
      setExtraReason('');
      setFormErr(null);
      invalidateDetail();
    },
    onError: (e: Error) => setFormErr(e.message),
  });

  const recalcMut = useMutation({
    mutationFn: () =>
      api<MfgProjectDetail>(`/manufacturing/projects/${projectId}/bom/recalculate`, {
        method: 'POST',
      }),
    onSuccess: invalidateDetail,
  });

  const bomLineMut = useMutation({
    mutationFn: (vars: { lineId: string; scrapPct?: string; issueAtStart?: boolean }) =>
      api<MfgProjectDetail>(
        `/manufacturing/projects/${projectId}/bom-lines/${vars.lineId}`,
        {
          method: 'PATCH',
          json: {
            ...(vars.scrapPct !== undefined ? { scrapPct: vars.scrapPct } : {}),
            ...(vars.issueAtStart !== undefined ? { issueAtStart: vars.issueAtStart } : {}),
          },
        },
      ),
    onSuccess: invalidateDetail,
    onError: (e: Error) => setFormErr(e.message),
  });

  const issueMut = useMutation({
    mutationFn: (vars: { bomLineId: string; quantity: string }) =>
      api<MfgProjectDetail>(`/manufacturing/projects/${projectId}/material-issues`, {
        method: 'POST',
        json: { bomLineId: vars.bomLineId, quantity: vars.quantity },
      }),
    onSuccess: () => {
      setFormErr(null);
      invalidateDetail();
    },
    onError: (e: Error) => setFormErr(e.message),
  });

  const linkDepositMut = useMutation({
    mutationFn: (saleId: string) =>
      api<MfgProjectDetail>(`/manufacturing/projects/${projectId}/link-deposit`, {
        method: 'POST',
        json: { saleId },
      }),
    onSuccess: () => {
      setDepositSaleId('');
      setFormErr(null);
      invalidateDetail();
    },
    onError: (e: Error) => setFormErr(e.message),
  });

  const data =
    detailQ.data?.id === projectId ? detailQ.data : undefined;
  const detailLoading =
    detailQ.isLoading || detailQ.isFetching || (detailQ.data != null && detailQ.data.id !== projectId);

  if (!data) {
    return (
      <FormModalBackdrop className="no-print" onClose={onClose}>
        <div className="modal modal--wide" role="dialog" onClick={(e) => e.stopPropagation()}>
          <p className="muted">{detailLoading ? 'Carregando…' : 'Projeto não encontrado.'}</p>
          <div className="modal-actions">
            <button type="button" className="btn btn-secondary" onClick={onClose}>
              Fechar
            </button>
          </div>
        </div>
      </FormModalBackdrop>
    );
  }

  const next = NEXT_MFG_STATUS[data.status];
  const editable = canEdit(data.status);
  const assignees = assigneesQ.data ?? [];

  return (
    <FormCadastroModal
      onClose={onClose}
      size="xl"
      backdropClassName="no-print"
      dialogLabel={`Projeto de fabricação #${data.number}`}
      title={
        <>
          Projeto #{data.number} — <ManufacturingStatusChip status={data.status} />
        </>
      }
      hint={
        <>
          {MFG_SOURCE_LABEL[data.source]} · {data.customer.name} · {data.finishedVariant.product.name}{' '}
          × {data.quantity}
          {' · '}
          {data.bomLines.length} insumo{data.bomLines.length === 1 ? '' : 's'} · {data.statusHistory.length}{' '}
          registro{data.statusHistory.length === 1 ? '' : 's'} no histórico
          {data.externalRef?.startsWith('wa:') ? (
            <>
              {' · '}
              <span title={data.externalRef}>Lead WhatsApp bot</span>
            </>
          ) : null}
        </>
      }
      headerExtra={
        <>
          {formErr ? <div className="alert alert-error">{formErr}</div> : null}
          <div className="modal-actions" style={{ justifyContent: 'flex-start', flexWrap: 'wrap', marginBottom: 0 }}>
            <Link
              to={`/fabrica/impressao?id=${encodeURIComponent(data.id)}`}
              className="btn btn-secondary btn-compact"
              target="_blank"
              rel="noreferrer"
            >
              Orçamento (PDF)
            </Link>
            <Link
              to={`/vendas?mfgCustomer=${encodeURIComponent(data.customer.id)}&mfgProject=${encodeURIComponent(data.id)}`}
              className="btn btn-secondary btn-compact"
              title="Abre o PDV com o cliente e uma linha de sinal (valor previsto), sem baixar estoque do PA"
            >
              PDV — registrar sinal
            </Link>
            {editable ? (
              <button
                type="button"
                className="btn btn-secondary btn-compact"
                disabled={recalcMut.isPending}
                onClick={() => recalcMut.mutate()}
              >
                {recalcMut.isPending ? 'Recalculando…' : 'Recalcular BOM da ficha'}
              </button>
            ) : null}
          </div>
        </>
      }
      footer={
        <>
          {editable ? (
            <div className="field" style={{ flex: '1 1 100%', marginBottom: '0.5rem' }}>
              <label htmlFor="mfg-status-note">Nota ao avançar ou cancelar (opcional)</label>
              <input
                id="mfg-status-note"
                value={statusNote}
                onChange={(e) => setStatusNote(e.target.value)}
                placeholder="Ex.: atraso por falta de insumo, cliente pediu revisão…"
              />
            </div>
          ) : null}
          {next && editable ? (
            <button
              type="button"
              className="btn btn-primary"
              disabled={statusMut.isPending}
              onClick={() => statusMut.mutate({ status: next, note: statusNote })}
            >
              Avançar → {MFG_STATUS_LABEL[next]}
            </button>
          ) : null}
          {editable ? (
            <button
              type="button"
              className="btn btn-danger"
              disabled={statusMut.isPending}
              onClick={() => statusMut.mutate({ status: 'CANCELLED', note: statusNote })}
            >
              Cancelar projeto
            </button>
          ) : null}
          <button type="button" className="btn btn-secondary" onClick={onClose}>
            Fechar
          </button>
        </>
      }
    >
        <h3 className="product-form__section-title">Depósito (venda PDV)</h3>
        {data.depositSale ? (
          <p>
            Vinculada: venda #{data.depositSale.number} — {formatBRL(data.depositSale.total)} (
            {data.depositSale.status})
          </p>
        ) : (
          <p className="muted">Nenhuma venda de sinal vinculada.</p>
        )}
        {editable ? (
          <div className="form-row" style={{ alignItems: 'flex-end', gap: '0.5rem' }}>
            <div className="field" style={{ flex: 1 }}>
              <label htmlFor="mfg-d-sale-id">ID da venda (após registrar no PDV)</label>
              <input
                id="mfg-d-sale-id"
                value={depositSaleId}
                onChange={(e) => setDepositSaleId(e.target.value)}
                placeholder="UUID da venda"
              />
            </div>
            <button
              type="button"
              className="btn btn-secondary btn-compact"
              disabled={!depositSaleId.trim() || linkDepositMut.isPending}
              onClick={() => linkDepositMut.mutate(depositSaleId.trim())}
            >
              Vincular
            </button>
          </div>
        ) : null}
        {data.sale ? (
          <p className="muted">Venda final: #{data.sale.number}</p>
        ) : null}

        <h3 className="product-form__section-title">BOM (insumos)</h3>
        <div className="table-wrap table-wrap--scroll-only table-wrap--no-cards">
          <table className="data-table data-table--no-cards">
            <thead>
              <tr>
                <th>Insumo</th>
                <th className="num">Planejado</th>
                <th className="num">Reservado</th>
                <th className="num">Consumido</th>
                <th className="num">Scrap %</th>
                <th>Início</th>
                {editable ? <th>Baixa manual</th> : null}
              </tr>
            </thead>
            <tbody>
              {!data.bomLines.length ? (
                <tr>
                  <td colSpan={editable ? 7 : 6} className="empty">
                    Nenhum insumo. Cadastre a ficha técnica do PA em Fábrica → Fichas técnicas e use
                    &quot;Recalcular BOM da ficha&quot;.
                  </td>
                </tr>
              ) : null}
              {data.bomLines.map((l) => (
                <tr key={l.id}>
                  <td>{l.ingredientVariant.product.name}</td>
                  <td className="num">{l.plannedQty}</td>
                  <td className="num">{l.reservedQty}</td>
                  <td className="num">{l.consumedQty}</td>
                  <td className="num">
                    {editable ? (
                      <input
                        type="number"
                        min={0}
                        max={100}
                        step="0.01"
                        className="input-compact"
                        style={{ width: '4.5rem' }}
                        defaultValue={l.scrapPct}
                        onBlur={(e) => {
                          const v = e.target.value;
                          if (v !== l.scrapPct) {
                            bomLineMut.mutate({ lineId: l.id, scrapPct: v });
                          }
                        }}
                      />
                    ) : (
                      l.scrapPct
                    )}
                  </td>
                  <td>
                    {editable ? (
                      <label style={{ display: 'flex', gap: '0.35rem', alignItems: 'center' }}>
                        <input
                          type="checkbox"
                          checked={l.issueAtStart}
                          onChange={(e) =>
                            bomLineMut.mutate({ lineId: l.id, issueAtStart: e.target.checked })
                          }
                        />
                        100% início
                      </label>
                    ) : l.issueAtStart ? (
                      'Sim'
                    ) : (
                      'Não'
                    )}
                  </td>
                  {editable ? (
                    <td>
                      <div style={{ display: 'flex', gap: '0.35rem', alignItems: 'center' }}>
                        <input
                          type="text"
                          className="input-compact"
                          style={{ width: '4rem' }}
                          placeholder="Qtd"
                          value={issueQty[l.id] ?? ''}
                          onChange={(e) =>
                            setIssueQty((s) => ({ ...s, [l.id]: e.target.value }))
                          }
                        />
                        <button
                          type="button"
                          className="btn btn-secondary btn-compact"
                          disabled={issueMut.isPending || !(issueQty[l.id] ?? '').trim()}
                          onClick={() =>
                            issueMut.mutate({
                              bomLineId: l.id,
                              quantity: issueQty[l.id]!.trim(),
                            })
                          }
                        >
                          Baixar
                        </button>
                      </div>
                    </td>
                  ) : null}
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {editable ? (
          <>
            <details className="submenu-details" style={{ marginBottom: '0.65rem' }}>
              <summary className="submenu-summary">
                Apontamento (sem mudar fase) — {MFG_STATUS_LABEL[data.status]}
              </summary>
              <p className="muted" style={{ marginTop: 0 }}>
                Registre ocorrências na fase atual: falta, atraso, retrabalho, observação de produção.
                Não altera o kanban.
              </p>
              <div className="field">
                <label htmlFor="mfg-apontamento">Texto do apontamento</label>
                <textarea
                  id="mfg-apontamento"
                  rows={2}
                  value={apontamentoNote}
                  onChange={(e) => setApontamentoNote(e.target.value)}
                  placeholder="Descreva o que aconteceu…"
                />
              </div>
              <div className="modal-actions" style={{ justifyContent: 'flex-start', marginTop: 0 }}>
                <button
                  type="button"
                  className="btn btn-secondary btn-compact"
                  disabled={!apontamentoNote.trim() || apontamentoMut.isPending}
                  onClick={() => apontamentoMut.mutate(apontamentoNote.trim())}
                >
                  {apontamentoMut.isPending ? 'Registrando…' : 'Registrar apontamento'}
                </button>
              </div>
            </details>

            <details className="submenu-details" style={{ marginBottom: '0.65rem' }}>
              <summary className="submenu-summary">Insumo adicional (perda / retrabalho)</summary>
              <p className="muted" style={{ marginTop: 0 }}>
                Soma quantidade no planejado da BOM. Se o projeto já reservou estoque, aumenta a reserva.
                Marque baixa imediata para consumir do estoque agora.
              </p>
              {extraIng ? (
                <p>
                  Selecionado: <strong>{extraIng.productName}</strong> ({extraIng.sku}){' '}
                  <button
                    type="button"
                    className="btn btn-secondary btn-compact"
                    onClick={() => setExtraIng(null)}
                  >
                    Trocar
                  </button>
                </p>
              ) : (
                <>
                  <div className="field">
                    <label htmlFor="mfg-extra-ing">Pesquisar insumo</label>
                    <input
                      id="mfg-extra-ing"
                      value={extraIngQ}
                      onChange={(e) => setExtraIngQ(e.target.value)}
                      placeholder="Nome ou SKU (mín. 2 caracteres)"
                    />
                  </div>
                  {extraIngSearchQ.data?.length ? (
                    <ul className="simple-list" style={{ marginBottom: '0.75rem' }}>
                      {extraIngSearchQ.data.slice(0, 8).map((p) => (
                        <li key={p.variantId}>
                          <button
                            type="button"
                            className="link-button"
                            onClick={() => {
                              setExtraIng(p);
                              setExtraIngQ('');
                            }}
                          >
                            {p.productName} — {p.sku}
                          </button>
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </>
              )}
              <div className="form-row form-row--2">
                <div className="field">
                  <label htmlFor="mfg-extra-qty">Quantidade extra</label>
                  <input
                    id="mfg-extra-qty"
                    value={extraQty}
                    onChange={(e) => setExtraQty(e.target.value)}
                    placeholder="Ex.: 2,5"
                  />
                </div>
                <div className="field">
                  <label htmlFor="mfg-extra-reason">Motivo (opcional)</label>
                  <input
                    id="mfg-extra-reason"
                    value={extraReason}
                    onChange={(e) => setExtraReason(e.target.value)}
                    placeholder="Perda, quebra, mau corte…"
                  />
                </div>
              </div>
              <label style={{ display: 'flex', gap: '0.35rem', alignItems: 'center', marginBottom: '0.5rem' }}>
                <input
                  type="checkbox"
                  checked={extraIssueNow}
                  onChange={(e) => setExtraIssueNow(e.target.checked)}
                />
                Baixar estoque agora (além de aumentar o planejado)
              </label>
              <div className="modal-actions" style={{ justifyContent: 'flex-start', marginTop: 0 }}>
                <button
                  type="button"
                  className="btn btn-secondary btn-compact"
                  disabled={!extraIng || !extraQty.trim() || extraBomMut.isPending}
                  onClick={() => extraBomMut.mutate()}
                >
                  {extraBomMut.isPending ? 'Incluindo…' : 'Incluir insumo adicional'}
                </button>
              </div>
            </details>
          </>
        ) : null}

        <details className="submenu-details" style={{ marginBottom: '0.65rem' }}>
          <summary className="submenu-summary">
            Histórico de fases e apontamentos ({data.statusHistory.length})
          </summary>
          <div className="table-wrap table-wrap--scroll-only table-wrap--no-cards">
            <table className="data-table data-table--compact data-table--no-cards">
              <thead>
                <tr>
                  <th>Quando</th>
                  <th>De</th>
                  <th>Para</th>
                  <th>Nota</th>
                </tr>
              </thead>
              <tbody>
                {data.statusHistory.map((h) => {
                  const apont = isStatusApontamento(h.fromStatus, h.toStatus);
                  return (
                    <tr key={h.id}>
                      <td>{formatDateTime(h.createdAt)}</td>
                      <td>
                        {apont
                          ? 'Apontamento'
                          : h.fromStatus
                            ? MFG_STATUS_LABEL[h.fromStatus]
                            : '—'}
                      </td>
                      <td>{MFG_STATUS_LABEL[h.toStatus]}</td>
                      <td>{h.note ?? '—'}</td>
                    </tr>
                  );
                })}
                {!data.statusHistory.length ? (
                  <tr>
                    <td colSpan={4} className="empty">
                      Sem registros.
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </details>

        <details className="submenu-details" style={{ marginBottom: '0.65rem' }}>
          <summary className="submenu-summary">
            Baixas de material ({data.materialIssues.length})
          </summary>
          <div className="table-wrap table-wrap--scroll-only table-wrap--no-cards">
            <table className="data-table data-table--compact data-table--no-cards">
              <thead>
                <tr>
                  <th>Quando</th>
                  <th>Fase</th>
                  <th className="num">Qtd</th>
                </tr>
              </thead>
              <tbody>
                {data.materialIssues.map((m) => (
                  <tr key={m.id}>
                    <td>{formatDateTime(m.createdAt)}</td>
                    <td>{MFG_STATUS_LABEL[m.phase as MfgStatus] ?? m.phase}</td>
                    <td className="num">{m.quantity}</td>
                  </tr>
                ))}
                {!data.materialIssues.length ? (
                  <tr>
                    <td colSpan={3} className="empty">
                      Nenhuma baixa registrada (normal se % de baixa na Empresa → Fábrica estiver 0 e não
                      houver baixa manual).
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </details>

        <h3 className="product-form__section-title">Comercial e prazo</h3>
        <div className="form-row form-row--2">
          <div className="field">
            <label htmlFor="mfg-d-title">Título</label>
            <input
              id="mfg-d-title"
              value={edit.title}
              disabled={!editable}
              onChange={(e) => setEdit((s) => ({ ...s, title: e.target.value }))}
            />
          </div>
          <div className="field">
            <label htmlFor="mfg-d-qty">Quantidade PA</label>
            <input
              id="mfg-d-qty"
              value={edit.quantity}
              disabled={!editable}
              onChange={(e) => setEdit((s) => ({ ...s, quantity: e.target.value }))}
            />
          </div>
        </div>
        <div className="form-row form-row--2">
          <div className="field">
            <label htmlFor="mfg-d-prom">Prazo prometido</label>
            <input
              id="mfg-d-prom"
              type="date"
              value={edit.promisedAt}
              disabled={!editable}
              onChange={(e) => setEdit((s) => ({ ...s, promisedAt: e.target.value }))}
            />
          </div>
          <div className="field">
            <label htmlFor="mfg-d-quote">Valor orçado (R$)</label>
            <input
              id="mfg-d-quote"
              value={edit.quoteTotal}
              disabled={!editable}
              onChange={(e) => setEdit((s) => ({ ...s, quoteTotal: e.target.value }))}
            />
          </div>
        </div>
        <div className="form-row form-row--2">
          <div className="field">
            <label htmlFor="mfg-d-dep">Sinal previsto (R$)</label>
            <input
              id="mfg-d-dep"
              value={edit.depositAmount}
              disabled={!editable}
              onChange={(e) => setEdit((s) => ({ ...s, depositAmount: e.target.value }))}
            />
          </div>
          <div className="field">
            <label htmlFor="mfg-d-comm">Resp. comercial</label>
            <select
              id="mfg-d-comm"
              value={edit.commercialResponsibleId}
              disabled={!editable}
              onChange={(e) => setEdit((s) => ({ ...s, commercialResponsibleId: e.target.value }))}
            >
              <option value="">—</option>
              {assignees.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div className="field">
          <label htmlFor="mfg-d-tech">Resp. técnico</label>
          <select
            id="mfg-d-tech"
            value={edit.technicalResponsibleId}
            disabled={!editable}
            onChange={(e) => setEdit((s) => ({ ...s, technicalResponsibleId: e.target.value }))}
          >
            <option value="">—</option>
            {assignees.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
        </div>

        <div className="field">
          <label htmlFor="mfg-d-brief">Brief do cliente</label>
          <textarea
            id="mfg-d-brief"
            rows={2}
            value={edit.customerBrief}
            disabled={!editable}
            onChange={(e) => setEdit((s) => ({ ...s, customerBrief: e.target.value }))}
          />
        </div>
        <div className="field">
          <label htmlFor="mfg-d-spec">Especificação técnica</label>
          <textarea
            id="mfg-d-spec"
            rows={2}
            value={edit.technicalSpec}
            disabled={!editable}
            onChange={(e) => setEdit((s) => ({ ...s, technicalSpec: e.target.value }))}
          />
        </div>
        <div className="field">
          <label htmlFor="mfg-d-qa">QA / testes</label>
          <textarea
            id="mfg-d-qa"
            rows={2}
            value={edit.qualityNotes}
            disabled={!editable}
            onChange={(e) => setEdit((s) => ({ ...s, qualityNotes: e.target.value }))}
          />
        </div>
        <div className="field">
          <label htmlFor="mfg-d-del">Entrega</label>
          <textarea
            id="mfg-d-del"
            rows={2}
            value={edit.deliveryNotes}
            disabled={!editable}
            onChange={(e) => setEdit((s) => ({ ...s, deliveryNotes: e.target.value }))}
          />
        </div>
        <div className="field">
          <label htmlFor="mfg-d-int">Notas internas</label>
          <textarea
            id="mfg-d-int"
            rows={2}
            value={edit.internalNotes}
            disabled={!editable}
            onChange={(e) => setEdit((s) => ({ ...s, internalNotes: e.target.value }))}
          />
        </div>

        {editable ? (
          <div className="modal-actions" style={{ justifyContent: 'flex-start', marginTop: '0.5rem' }}>
            <button
              type="button"
              className="btn btn-primary btn-compact"
              disabled={patchMut.isPending}
              onClick={() => patchMut.mutate()}
            >
              {patchMut.isPending ? 'Salvando…' : 'Salvar alterações'}
            </button>
          </div>
        ) : null}

    </FormCadastroModal>
  );
}
