import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { FormModalBackdrop } from '../../components/FormModalBackdrop';
import { CrudToolbar, RowRecordActions } from '../../components/CrudToolbar';
import { ModuleReportsModal } from '../../components/ModuleReportsModal';
import { RecordViewModal } from '../../components/RecordViewModal';
import { api } from '../../lib/api';

type Location = {
  id: string;
  code: string;
  name: string;
  isDefault: boolean;
  createdAt?: string;
};

export function StockLocaisPage() {
  const qc = useQueryClient();
  const [editLocation, setEditLocation] = useState<Location | null>(null);
  const [viewLocation, setViewLocation] = useState<Location | null>(null);
  const [deleteLocation, setDeleteLocation] = useState<Location | null>(null);
  const [reportsOpen, setReportsOpen] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [viewOpen, setViewOpen] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState(false);
  const [code, setCode] = useState('');
  const [locName, setLocName] = useState('');
  const [isDefault, setIsDefault] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const locations = useQuery({
    queryKey: ['stock-locations'],
    queryFn: () => api<Location[]>('/stock-locations'),
  });

  function resetForm() {
    setCode('');
    setLocName('');
    setIsDefault(false);
    setErr(null);
  }

  const createLoc = useMutation({
    mutationFn: () =>
      api<Location>('/stock-locations', {
        method: 'POST',
        json: { code, name: locName, isDefault },
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['stock-locations'] });
      setCreateOpen(false);
      resetForm();
    },
    onError: (e: Error) => setErr(e.message),
  });

  const updateLoc = useMutation({
    mutationFn: (id: string) =>
      api<Location>(`/stock-locations/${id}`, {
        method: 'PATCH',
        json: { code, name: locName, isDefault },
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['stock-locations'] });
      setEditOpen(false);
      setEditLocation(null);
      resetForm();
    },
    onError: (e: Error) => setErr(e.message),
  });

  const removeLoc = useMutation({
    mutationFn: (id: string) => api<{ ok: boolean }>(`/stock-locations/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['stock-locations'] });
      setDeleteConfirm(false);
      setDeleteLocation(null);
      setErr(null);
    },
    onError: (e: Error) => setErr(e.message),
  });

  const sortedLocs = useMemo(() => {
    const d = locations.data ?? [];
    return [...d].sort((a, b) => {
      const ta = a.createdAt ? new Date(a.createdAt).getTime() : 0;
      const tb = b.createdAt ? new Date(b.createdAt).getTime() : 0;
      return tb - ta;
    });
  }, [locations.data]);

  return (
    <div className="print-area">
      <CrudToolbar
        onInclude={() => {
          resetForm();
          setCreateOpen(true);
        }}
        onPrint={() => window.print()}
        onReports={() => setReportsOpen(true)}
      />

      <ModuleReportsModal open={reportsOpen} title="Locais de estoque" onClose={() => setReportsOpen(false)}>
        <ul style={{ margin: 0, paddingLeft: '1.2rem' }}>
          <li>Lista de locais com saldo agregado (a implementar)</li>
          <li>Transferências entre locais — veja o menu <strong>Estoque → Transferências</strong></li>
        </ul>
      </ModuleReportsModal>

      <div className="card">
        <h2 className="page-title" style={{ fontSize: '1.05rem', marginBottom: '0.5rem' }}>
          Locais de estoque (últimos cadastros primeiro)
        </h2>
        <p className="page-desc" style={{ marginBottom: '1rem' }}>
          <strong>Incluir</strong> abre o cadastro de novo local.
        </p>
      <div className="toolbar no-print">
        <span style={{ color: 'var(--color-text-muted)', fontSize: '0.9rem' }}>
          {locations.data?.length ?? 0} local(is)
        </span>
      </div>
      {locations.isError && (
        <div className="alert alert-error">{(locations.error as Error).message}</div>
      )}
      <div className="table-wrap">
        <table className="data-table">
          <thead>
            <tr>
              <th className="num" style={{ width: '3.2rem' }}>
                Cont.
              </th>
              <th>Código</th>
              <th>Nome</th>
              <th>Padrão</th>
              <th className="col-actions">Ações</th>
            </tr>
          </thead>
          <tbody>
            {locations.isLoading && (
              <tr>
                <td colSpan={5} className="empty">
                  Carregando…
                </td>
              </tr>
            )}
            {!locations.isLoading && !sortedLocs.length && (
              <tr>
                <td colSpan={5} className="empty">
                  Cadastre pelo menos um local (ex.: Matriz).
                </td>
              </tr>
            )}
            {sortedLocs.map((l, idx) => (
              <tr key={l.id}>
                <td className="num">{idx + 1}</td>
                <td>
                  <strong>{l.code}</strong>
                </td>
                <td>{l.name}</td>
                <td>
                  {l.isDefault ? <span className="badge badge-success">Padrão</span> : '—'}
                </td>
                <td className="col-actions">
                  <RowRecordActions
                    onEdit={() => {
                      setCode(l.code);
                      setLocName(l.name);
                      setIsDefault(l.isDefault);
                      setErr(null);
                      setEditLocation(l);
                      setEditOpen(true);
                    }}
                    onView={() => {
                      setViewLocation(l);
                      setViewOpen(true);
                    }}
                    onDelete={() => {
                      setDeleteLocation(l);
                      setDeleteConfirm(true);
                    }}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      </div>

      {createOpen && (
        <FormModalBackdrop
          className="no-print"
          onClose={() => {
            setCreateOpen(false);
            setErr(null);
          }}
        >
          <div className="modal" role="dialog" onClick={(e) => e.stopPropagation()}>
            <h2>Novo local de estoque</h2>
            {err && <div className="alert alert-error">{err}</div>}
            <div className="form-row">
              <div className="field">
                <label htmlFor="sl-code">Código *</label>
                <input id="sl-code" value={code} onChange={(e) => setCode(e.target.value)} required />
              </div>
              <div className="field">
                <label htmlFor="sl-name">Nome *</label>
                <input id="sl-name" value={locName} onChange={(e) => setLocName(e.target.value)} required />
              </div>
            </div>
            <div className="field">
              <label style={{ flexDirection: 'row', alignItems: 'center', gap: '0.5rem' }}>
                <input
                  type="checkbox"
                  checked={isDefault}
                  onChange={(e) => setIsDefault(e.target.checked)}
                />
                Definir como local padrão (vendas usam este saldo)
              </label>
            </div>
            <div className="modal-actions">
              <button type="button" className="btn btn-secondary" onClick={() => setCreateOpen(false)}>
                Cancelar
              </button>
              <button
                type="button"
                className="btn btn-primary"
                disabled={!code.trim() || !locName.trim() || createLoc.isPending}
                onClick={() => createLoc.mutate()}
              >
                Salvar
              </button>
            </div>
          </div>
        </FormModalBackdrop>
      )}

      <RecordViewModal
        open={Boolean(viewLocation && viewOpen)}
        title="Local — visualização"
        onClose={() => setViewOpen(false)}
        sections={
          viewLocation
            ? [
                {
                  title: 'Dados do local',
                  fields: [
                    { label: 'Código', value: viewLocation.code },
                    { label: 'Nome', value: viewLocation.name },
                    { label: 'Padrão', value: viewLocation.isDefault ? 'Sim' : 'Não' },
                  ],
                },
              ]
            : []
        }
      />

      {editLocation && editOpen && (
        <FormModalBackdrop className="no-print" onClose={() => setEditOpen(false)}>
          <div className="modal" role="dialog" onClick={(e) => e.stopPropagation()}>
            <h2>Alterar local</h2>
            {err && <div className="alert alert-error">{err}</div>}
            <div className="form-row">
              <div className="field">
                <label htmlFor="sle-code">Código *</label>
                <input id="sle-code" value={code} onChange={(e) => setCode(e.target.value)} required />
              </div>
              <div className="field">
                <label htmlFor="sle-name">Nome *</label>
                <input id="sle-name" value={locName} onChange={(e) => setLocName(e.target.value)} required />
              </div>
            </div>
            <div className="field">
              <label style={{ flexDirection: 'row', alignItems: 'center', gap: '0.5rem' }}>
                <input
                  type="checkbox"
                  checked={isDefault}
                  onChange={(e) => setIsDefault(e.target.checked)}
                />
                Local padrão
              </label>
            </div>
            <div className="modal-actions">
              <button type="button" className="btn btn-secondary" onClick={() => setEditOpen(false)}>
                Cancelar
              </button>
              <button
                type="button"
                className="btn btn-primary"
                disabled={!code.trim() || !locName.trim() || updateLoc.isPending}
                onClick={() => updateLoc.mutate(editLocation.id)}
              >
                Salvar
              </button>
            </div>
          </div>
        </FormModalBackdrop>
      )}

      {deleteLocation && deleteConfirm && (
        <FormModalBackdrop className="no-print" onClose={() => setDeleteConfirm(false)}>
          <div className="modal" role="dialog" onClick={(e) => e.stopPropagation()}>
            <h2>Excluir local</h2>
            <p>
              Confirma a exclusão de <strong>{deleteLocation.code}</strong> — {deleteLocation.name}? Só é permitido se
              não houver movimentações e saldo zero.
            </p>
            {err && <div className="alert alert-error">{err}</div>}
            <div className="modal-actions">
              <button type="button" className="btn btn-secondary" onClick={() => setDeleteConfirm(false)}>
                Cancelar
              </button>
              <button
                type="button"
                className="btn btn-danger"
                disabled={removeLoc.isPending}
                onClick={() => removeLoc.mutate(deleteLocation.id)}
              >
                Excluir
              </button>
            </div>
          </div>
        </FormModalBackdrop>
      )}
    </div>
  );
}
