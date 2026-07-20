import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type Dispatch, type SetStateAction } from 'react';

import { FormModalBackdrop } from '../components/FormModalBackdrop';
import { CrudToolbar } from '../components/CrudToolbar';
import { ListPagination } from '../components/ListPagination';
import { ModuleReportsModal } from '../components/ModuleReportsModal';
import { ReportPrintSticker } from '../components/ReportPrintSticker';
import { api } from '../lib/api';
import { useListPagination } from '../hooks/useListPagination';

type FiscalSituation = {
  id: string;
  code: string;
  name: string;
  description: string | null;
  exTipi: string | null;
  fiscalOrigin: string | null;
  cstIcms: string | null;
  csosn: string | null;
  cstPis: string | null;
  cstCofins: string | null;
  cfopInternal: string | null;
  cfopInterstate: string | null;
  ibsTestRate: string;
  cbsTestRate: string;
  regulationNotes: string | null;
  isActive: boolean;
};

const emptyDraft = (): Record<string, string> => ({
  code: '',
  name: '',
  description: '',
  exTipi: '',
  fiscalOrigin: '',
  cstIcms: '',
  csosn: '',
  cstPis: '',
  cstCofins: '',
  cfopInternal: '',
  cfopInterstate: '',
  ibsTestRate: '0.1',
  cbsTestRate: '0.9',
  regulationNotes: '',
});

function rowToDraft(row: FiscalSituation): Record<string, string> {
  return {
    code: row.code,
    name: row.name,
    description: row.description ?? '',
    exTipi: row.exTipi ?? '',
    fiscalOrigin: row.fiscalOrigin ?? '',
    cstIcms: row.cstIcms ?? '',
    csosn: row.csosn ?? '',
    cstPis: row.cstPis ?? '',
    cstCofins: row.cstCofins ?? '',
    cfopInternal: row.cfopInternal ?? '',
    cfopInterstate: row.cfopInterstate ?? '',
    ibsTestRate: String(row.ibsTestRate ?? '0'),
    cbsTestRate: String(row.cbsTestRate ?? '0'),
    regulationNotes: row.regulationNotes ?? '',
  };
}

/** Campos repetidos entre “nova” e “editar”. */
function FiscalSituationFormFields({
  draft,
  setDraft,
  idPrefix,
}: {
  draft: Record<string, string>;
  setDraft: Dispatch<SetStateAction<Record<string, string>>>;
  idPrefix: string;
}) {
  return (
    <>
      <div className="form-row">
        <div className="field">
          <label htmlFor={`${idPrefix}-code`}>Código único *</label>
          <input
            id={`${idPrefix}-code`}
            value={draft.code}
            onChange={(e) => setDraft((d) => ({ ...d, code: e.target.value }))}
            placeholder="RT2026-XYZ"
          />
        </div>
        <div className="field" style={{ flex: 2 }}>
          <label htmlFor={`${idPrefix}-name`}>Nome *</label>
          <input
            id={`${idPrefix}-name`}
            value={draft.name}
            onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
          />
        </div>
      </div>
      <div className="field">
        <label htmlFor={`${idPrefix}-desc`}>Descrição</label>
        <input
          id={`${idPrefix}-desc`}
          value={draft.description}
          onChange={(e) => setDraft((d) => ({ ...d, description: e.target.value }))}
        />
      </div>
      <div className="form-row">
        <div className="field">
          <label htmlFor={`${idPrefix}-extipi`}>EX TIPI</label>
          <input
            id={`${idPrefix}-extipi`}
            value={draft.exTipi}
            onChange={(e) => setDraft((d) => ({ ...d, exTipi: e.target.value }))}
          />
        </div>
      </div>
      <div className="form-row">
        <div className="field">
          <label htmlFor={`${idPrefix}-orig`}>Origem (0–8)</label>
          <input
            id={`${idPrefix}-orig`}
            value={draft.fiscalOrigin}
            onChange={(e) => setDraft((d) => ({ ...d, fiscalOrigin: e.target.value.slice(0, 2) }))}
          />
        </div>
        <div className="field">
          <label htmlFor={`${idPrefix}-csticms`}>CST ICMS</label>
          <input
            id={`${idPrefix}-csticms`}
            value={draft.cstIcms}
            onChange={(e) => setDraft((d) => ({ ...d, cstIcms: e.target.value.slice(0, 4) }))}
          />
        </div>
        <div className="field">
          <label htmlFor={`${idPrefix}-csosn`}>CSOSN</label>
          <input
            id={`${idPrefix}-csosn`}
            value={draft.csosn}
            onChange={(e) => setDraft((d) => ({ ...d, csosn: e.target.value.slice(0, 4) }))}
          />
        </div>
      </div>
      <div className="form-row">
        <div className="field">
          <label htmlFor={`${idPrefix}-cstpis`}>CST PIS</label>
          <input
            id={`${idPrefix}-cstpis`}
            value={draft.cstPis}
            onChange={(e) => setDraft((d) => ({ ...d, cstPis: e.target.value.slice(0, 4) }))}
          />
        </div>
        <div className="field">
          <label htmlFor={`${idPrefix}-cstcof`}>CST COFINS</label>
          <input
            id={`${idPrefix}-cstcof`}
            value={draft.cstCofins}
            onChange={(e) => setDraft((d) => ({ ...d, cstCofins: e.target.value.slice(0, 4) }))}
          />
        </div>
      </div>
      <div className="form-row">
        <div className="field">
          <label htmlFor={`${idPrefix}-cfopi`}>CFOP interno</label>
          <input
            id={`${idPrefix}-cfopi`}
            value={draft.cfopInternal}
            onChange={(e) =>
              setDraft((d) => ({ ...d, cfopInternal: e.target.value.replace(/\D/g, '').slice(0, 5) }))
            }
          />
        </div>
        <div className="field">
          <label htmlFor={`${idPrefix}-cfope`}>CFOP interestadual</label>
          <input
            id={`${idPrefix}-cfope`}
            value={draft.cfopInterstate}
            onChange={(e) =>
              setDraft((d) => ({ ...d, cfopInterstate: e.target.value.replace(/\D/g, '').slice(0, 5) }))
            }
          />
        </div>
        <div className="field">
          <label htmlFor={`${idPrefix}-ibs`}>IBS % teste</label>
          <input id={`${idPrefix}-ibs`} value={draft.ibsTestRate} onChange={(e) => setDraft((d) => ({ ...d, ibsTestRate: e.target.value }))} />
        </div>
        <div className="field">
          <label htmlFor={`${idPrefix}-cbs`}>CBS % teste</label>
          <input id={`${idPrefix}-cbs`} value={draft.cbsTestRate} onChange={(e) => setDraft((d) => ({ ...d, cbsTestRate: e.target.value }))} />
        </div>
      </div>
      <div className="field">
        <label htmlFor={`${idPrefix}-notes`}>Notas regulatórias</label>
        <textarea
          id={`${idPrefix}-notes`}
          rows={4}
          value={draft.regulationNotes}
          onChange={(e) => setDraft((d) => ({ ...d, regulationNotes: e.target.value }))}
          placeholder="Referências LC, atos conjuntos RFB/CGIBS, NT NT-e…"
        />
      </div>
    </>
  );
}

export function FiscalSituationsPage() {
  const qc = useQueryClient();
  const list = useQuery({
    queryKey: ['fiscal-situations'],
    queryFn: () => api<FiscalSituation[]>('/fiscal-situations'),
  });

  const pagination = useListPagination(list.data ?? []);

  const [creating, setCreating] = useState(false);
  const [draft, setDraft] = useState<Record<string, string>>(emptyDraft);
  const [err, setErr] = useState<string | null>(null);

  const [reportsOpen, setReportsOpen] = useState(false);
  const [viewOpen, setViewOpen] = useState(false);
  const [viewRow, setViewRow] = useState<FiscalSituation | null>(null);
  const [editOpen, setEditOpen] = useState(false);
  const [editingRow, setEditingRow] = useState<FiscalSituation | null>(null);
  const [editDraft, setEditDraft] = useState<Record<string, string>>(emptyDraft);

  const create = useMutation({
    mutationFn: () =>
      api('/fiscal-situations', {
        method: 'POST',
        json: {
          code: draft.code,
          name: draft.name,
          description: draft.description.trim() || null,
          exTipi: draft.exTipi.trim() || null,
          fiscalOrigin: draft.fiscalOrigin.trim() || null,
          cstIcms: draft.cstIcms.trim() || null,
          csosn: draft.csosn.trim() || null,
          cstPis: draft.cstPis.trim() || null,
          cstCofins: draft.cstCofins.trim() || null,
          cfopInternal: draft.cfopInternal.trim() || null,
          cfopInterstate: draft.cfopInterstate.trim() || null,
          ibsTestRate: parseFloat(draft.ibsTestRate.replace(',', '.')) || 0,
          cbsTestRate: parseFloat(draft.cbsTestRate.replace(',', '.')) || 0,
          regulationNotes: draft.regulationNotes.trim() || null,
        },
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['fiscal-situations'] });
      setCreating(false);
      setDraft(emptyDraft());
      setErr(null);
    },
    onError: (e: Error) => setErr(e.message),
  });

  const patch = useMutation({
    mutationFn: (payload: { id: string }) =>
      api(`/fiscal-situations/${payload.id}`, {
        method: 'PATCH',
        json: {
          code: editDraft.code,
          name: editDraft.name,
          description: editDraft.description.trim() || null,
          exTipi: editDraft.exTipi.trim() || null,
          fiscalOrigin: editDraft.fiscalOrigin.trim() || null,
          cstIcms: editDraft.cstIcms.trim() || null,
          csosn: editDraft.csosn.trim() || null,
          cstPis: editDraft.cstPis.trim() || null,
          cstCofins: editDraft.cstCofins.trim() || null,
          cfopInternal: editDraft.cfopInternal.trim() || null,
          cfopInterstate: editDraft.cfopInterstate.trim() || null,
          ibsTestRate: parseFloat(editDraft.ibsTestRate.replace(',', '.')) || 0,
          cbsTestRate: parseFloat(editDraft.cbsTestRate.replace(',', '.')) || 0,
          regulationNotes: editDraft.regulationNotes.trim() || null,
        },
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['fiscal-situations'] });
      setEditOpen(false);
      setEditingRow(null);
      setErr(null);
    },
    onError: (e: Error) => setErr(e.message),
  });

  const toggleActive = useMutation({
    mutationFn: (row: FiscalSituation) =>
      api(`/fiscal-situations/${row.id}`, {
        method: 'PATCH',
        json: { isActive: !row.isActive },
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['fiscal-situations'] }),
  });

  function openView(row: FiscalSituation) {
    setViewRow(row);
    setViewOpen(true);
  }

  function openEdit(row: FiscalSituation) {
    setErr(null);
    setEditingRow(row);
    setEditDraft(rowToDraft(row));
    setEditOpen(true);
  }

  return (
    <div className="print-area" style={{ marginTop: '1rem' }}>
      <ReportPrintSticker
        documentTitle="Cadastros gerais — Situação fiscal"
        documentExtras={
          <p className="print-sub page-desc" style={{ marginBottom: 0 }}>
            Listagem mestre ao momento da impressão (Ctrl+P ou botão Imprimir).
          </p>
        }
      />

      {err && (
        <div className="alert alert-error no-print" style={{ marginBottom: '0.85rem' }}>
          {err}
        </div>
      )}

      <CrudToolbar
        onInclude={() => {
          setErr(null);
          setCreating(true);
          setDraft(emptyDraft());
        }}
        onPrint={() => window.print()}
        onReports={() => setReportsOpen(true)}
        includeLabel="Nova situação fiscal"
      />

      <ModuleReportsModal open={reportsOpen} title="Cadastros gerais · Situação fiscal" onClose={() => setReportsOpen(false)}>
        <ul style={{ margin: 0, paddingLeft: '1.2rem' }}>
          <li>Exportação CST/CFOP para auditoria (a implementar)</li>
          <li>Histórico de alterações por situação (a implementar)</li>
        </ul>
      </ModuleReportsModal>

      <div className="toolbar no-print" style={{ justifyContent: 'space-between', flexWrap: 'wrap', gap: '0.5rem' }}>
        <span style={{ color: 'var(--color-text-muted)', fontSize: '0.9rem' }}>
          {(list.data ?? []).length} registro(s)
        </span>
        <a
          href="https://www.gov.br/fazenda/pt-br/"
          target="_blank"
          rel="noopener noreferrer"
          className="btn btn-ghost"
          style={{ fontSize: '0.85rem' }}
        >
          gov.br · Fazenda (normas atualizadas)
        </a>
      </div>

      {creating && (
        <div className="card no-print" style={{ padding: '1rem', marginBottom: '1.25rem' }}>
          <h2 style={{ marginTop: 0, fontSize: '1rem' }}>Nova situação fiscal</h2>
          <p style={{ margin: '0 0 0.85rem', fontSize: '0.82rem', color: 'var(--color-text-muted)' }}>
            Conforme LC 214/2025 e regulamentos CBS / IBS. Aqui ficam CST, CFOP, origem etc. As alíquotas &quot;teste&quot; são percentuais
            (ex.: 0,9 e 0,1) — confirme valores vigentes nos atos conjuntos RFB/CGIBS.
          </p>
          <FiscalSituationFormFields draft={draft} setDraft={setDraft} idPrefix="nova" />
          <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.85rem', flexWrap: 'wrap' }}>
            <button type="button" className="btn btn-secondary" onClick={() => setCreating(false)}>
              Cancelar
            </button>
            <button type="button" className="btn btn-primary" disabled={create.isPending} onClick={() => create.mutate()}>
              {create.isPending ? 'Salvando…' : 'Gravar cadastro'}
            </button>
          </div>
        </div>
      )}

      {list.isLoading && <p style={{ color: 'var(--color-text-secondary)' }}>Carregando…</p>}
      {list.isError && <div className="alert alert-error">{(list.error as Error).message}</div>}

      <div className="table-wrap">
        <table className="data-table">
          <thead>
            <tr>
              <th>Código</th>
              <th>Nome</th>
              <th>CST ICMS</th>
              <th>CFOP int.</th>
              <th>% IBS/CBS teste</th>
              <th>Status</th>
              <th className="col-actions no-print">Ações</th>
            </tr>
          </thead>
          <tbody>
            {(list.data ?? []).length === 0 && !list.isLoading && (
              <tr>
                <td colSpan={7} style={{ padding: '1.25rem', textAlign: 'center', color: 'var(--color-text-muted)' }}>
                  Nenhuma situação cadastrada. Use o formulário ou rode o provisionamento inicial do tenant.
                </td>
              </tr>
            )}
            {pagination.pageItems.map((row) => (
              <tr key={row.id}>
                <td>
                  <code>{row.code}</code>
                </td>
                <td>
                  <strong>{row.name}</strong>
                  {row.description ? (
                    <span style={{ display: 'block', fontSize: '0.78rem', color: 'var(--color-text-muted)' }}>{row.description}</span>
                  ) : null}
                </td>
                <td>{row.cstIcms ?? row.csosn ?? '—'}</td>
                <td>{row.cfopInternal ?? '—'}</td>
                <td style={{ fontVariantNumeric: 'tabular-nums' }}>
                  {row.ibsTestRate}% / {row.cbsTestRate}%
                </td>
                <td>{row.isActive ? 'Ativa' : 'Inativa'}</td>
                <td className="col-actions no-print">
                  <div className="row-record-actions" style={{ flexWrap: 'wrap' }}>
                    <button type="button" className="btn btn-secondary btn-compact" onClick={() => openView(row)}>
                      Exibir
                    </button>
                    <button type="button" className="btn btn-secondary btn-compact" onClick={() => openEdit(row)}>
                      Editar
                    </button>
                    <button
                      type="button"
                      className="btn btn-ghost btn-compact"
                      style={{ fontSize: '0.78rem' }}
                      onClick={() => toggleActive.mutate(row)}
                    >
                      {row.isActive ? 'Desativar' : 'Reativar'}
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <ListPagination
        page={pagination.page}
        totalPages={pagination.totalPages}
        totalItems={pagination.totalItems}
        pageSize={pagination.pageSize}
        onPageChange={pagination.setPage}
        itemLabel="situação(ões)"
      />

      {viewRow && viewOpen && (
        <div className="modal-backdrop no-print" role="presentation" onClick={() => setViewOpen(false)}>
          <div className="modal modal--wide" role="dialog" onClick={(e) => e.stopPropagation()}>
            <h2>Situação fiscal — exibir</h2>
            <div style={{ fontSize: '0.9rem', display: 'grid', gap: '0.45rem', maxHeight: '70vh', overflowY: 'auto' }}>
              <p>
                <strong>Código:</strong> <code>{viewRow.code}</code>
              </p>
              <p>
                <strong>Nome:</strong> {viewRow.name}
              </p>
              <p>
                <strong>Descrição:</strong> {viewRow.description ?? '—'}
              </p>
              <p>
                <strong>EX TIPI:</strong> {viewRow.exTipi ?? '—'}
              </p>
              <p>
                <strong>Origem:</strong> {viewRow.fiscalOrigin ?? '—'}
              </p>
              <p>
                <strong>CST ICMS / CSOSN:</strong> {(viewRow.cstIcms ?? '—') + ' / ' + (viewRow.csosn ?? '—')}
              </p>
              <p>
                <strong>CST PIS / COFINS:</strong> {(viewRow.cstPis ?? '—') + ' / ' + (viewRow.cstCofins ?? '—')}
              </p>
              <p>
                <strong>CFOP interno / interestadual:</strong> {(viewRow.cfopInternal ?? '—') + ' / ' + (viewRow.cfopInterstate ?? '—')}
              </p>
              <p>
                <strong>IBS / CBS % teste:</strong> {viewRow.ibsTestRate}% / {viewRow.cbsTestRate}%
              </p>
              <p>
                <strong>Status:</strong> {viewRow.isActive ? 'Ativa' : 'Inativa'}
              </p>
              <p style={{ whiteSpace: 'pre-wrap' }}>
                <strong>Notas regulatórias:</strong> {viewRow.regulationNotes ?? '—'}
              </p>
            </div>
            <div className="modal-actions">
              <button type="button" className="btn btn-primary" onClick={() => setViewOpen(false)}>
                Fechar
              </button>
            </div>
          </div>
        </div>
      )}

      {editingRow && editOpen && (
        <FormModalBackdrop
          className="no-print"
          onClose={() => {
            setEditOpen(false);
            setErr(null);
          }}
        >
          <div className="modal modal--wide" role="dialog" onClick={(e) => e.stopPropagation()}>
            <h2>Situação fiscal — editar</h2>
            {err && <div className="alert alert-error">{err}</div>}
            <FiscalSituationFormFields draft={editDraft} setDraft={setEditDraft} idPrefix="edit" />
            <div className="modal-actions">
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => {
                  setEditOpen(false);
                  setEditingRow(null);
                  setErr(null);
                }}
              >
                Cancelar
              </button>
              <button
                type="button"
                className="btn btn-primary"
                disabled={!editDraft.code.trim() || !editDraft.name.trim() || patch.isPending}
                onClick={() => patch.mutate({ id: editingRow.id })}
              >
                {patch.isPending ? 'Salvando…' : 'Salvar alterações'}
              </button>
            </div>
          </div>
        </FormModalBackdrop>
      )}

      <div className="card print-legal-reminder no-print" style={{ marginTop: '1.25rem', padding: '0.95rem', fontSize: '0.82rem', color: 'var(--color-text-secondary)' }}>
        <strong>Lembrete jurídico:</strong> estes valores são cadastro mestre para preparar NF-e/NFC-e. A obrigatoriedade de destaque CBS/IBS em DFe segue cronogramas
        publicados pela Receita Federal e pelo CGIBS; confirme com seu contador e com a{' '}
        <a href="https://www.receitafederal.gov.br" target="_blank" rel="noopener noreferrer">
          RFB
        </a>
        .
      </div>
    </div>
  );
}
