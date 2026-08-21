/**
 * Ordens de Serviço: abertura, execução, consumo de peças e faturamento.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { CrudToolbar } from '../components/CrudToolbar';
import { FormModalBackdrop } from '../components/FormModalBackdrop';
import { ModuleReportsModal } from '../components/ModuleReportsModal';
import { ProductSearchModal, type ProductSearchRow } from '../components/ProductSearchModal';
import { api } from '../lib/api';
import { hasServiceOrderModule } from '../lib/auth';
import { formatBRL } from '../lib/format';
import { useMenuAccess } from '../hooks/useMenuAccess';

type OsStatus =
  | 'DRAFT'
  | 'QUOTE'
  | 'APPROVED'
  | 'IN_PROGRESS'
  | 'WAITING_PARTS'
  | 'READY'
  | 'DELIVERED'
  | 'BILLED'
  | 'CANCELLED';

type OsItem = {
  id?: string;
  kind: string;
  variantId: string | null;
  description: string | null;
  quantity: string;
  unitPrice: string;
  discount: string;
  totalLine: string;
  consumedAt?: string | null;
  variant?: {
    id: string;
    sku: string;
    product: { id: string; name: string; isService: boolean };
  } | null;
};

type OsRow = {
  id: string;
  number: number;
  status: OsStatus;
  type: string;
  openedAt: string;
  promisedAt: string | null;
  customer: { id: string; name: string; document: string | null; phone: string | null };
  equipment: { id: string; label: string; serialNumber: string | null; plateOrTag: string | null } | null;
  assetDescription: string | null;
  problemReport: string | null;
  diagnosis: string | null;
  internalNotes: string | null;
  assignedTo: { id: string; name: string } | null;
  items: OsItem[];
  itemsTotal: number;
  depositAmount: string;
  balanceDue: number;
  depositCredit?: number;
  sale: { id: string; number: number; total: string } | null;
  intakeChecklist?: Array<{ label: string; checked?: boolean }> | null;
  statusHistory?: Array<{
    id: string;
    fromStatus: string | null;
    toStatus: string;
    note: string | null;
    createdAt: string;
  }>;
};

type CustomerHit = { id: string; name: string; document: string | null; phone: string | null };
type Equipment = {
  id: string;
  label: string;
  equipmentType: string | null;
  brand: string | null;
  model: string | null;
  serialNumber: string | null;
  plateOrTag: string | null;
};
type UserRow = { id: string; name: string; isActive: boolean };

type DraftItem = {
  key: string;
  kind: string;
  variantId: string | null;
  productName: string;
  description: string;
  quantity: string;
  unitPrice: string;
  discount: string;
};

const STATUS_LABEL: Record<OsStatus, string> = {
  DRAFT: 'Rascunho',
  QUOTE: 'Orçamento',
  APPROVED: 'Aprovada',
  IN_PROGRESS: 'Em andamento',
  WAITING_PARTS: 'Aguardando peça',
  READY: 'Pronta',
  DELIVERED: 'Entregue',
  BILLED: 'Faturada',
  CANCELLED: 'Cancelada',
};

const TYPE_LABEL: Record<string, string> = {
  CORRECTIVE: 'Corretiva',
  PREVENTIVE: 'Preventiva',
  WARRANTY: 'Garantia',
  INSTALLATION: 'Instalação',
  INSPECTION: 'Vistoria',
  OTHER: 'Outro',
};

const NEXT_STATUS: Partial<Record<OsStatus, OsStatus[]>> = {
  DRAFT: ['QUOTE', 'APPROVED', 'IN_PROGRESS', 'CANCELLED'],
  QUOTE: ['APPROVED', 'CANCELLED'],
  APPROVED: ['IN_PROGRESS', 'QUOTE', 'CANCELLED'],
  IN_PROGRESS: ['WAITING_PARTS', 'READY', 'APPROVED', 'CANCELLED'],
  WAITING_PARTS: ['IN_PROGRESS', 'READY', 'CANCELLED'],
  READY: ['DELIVERED', 'IN_PROGRESS', 'WAITING_PARTS', 'CANCELLED'],
  DELIVERED: ['READY', 'IN_PROGRESS', 'CANCELLED'],
};

function money(n: number | string) {
  return formatBRL(Number(n) || 0);
}

function lineTotal(it: DraftItem): number {
  const q = parseFloat(it.quantity.replace(',', '.')) || 0;
  const p = parseFloat(it.unitPrice.replace(',', '.')) || 0;
  const d = parseFloat(it.discount.replace(',', '.')) || 0;
  return Math.round(Math.max(0, q * p - d) * 100) / 100;
}

export function ServiceOrdersPage() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const menu = useMenuAccess();
  const moduleOk = hasServiceOrderModule();

  const [status, setStatus] = useState('ALL');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [q, setQ] = useState('');
  const [viewMode, setViewMode] = useState<'list' | 'kanban'>('list');
  const [reportsOpen, setReportsOpen] = useState(false);

  const [formOpen, setFormOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [billOpen, setBillOpen] = useState(false);

  const [customerQ, setCustomerQ] = useState('');
  const [customerId, setCustomerId] = useState('');
  const [customerName, setCustomerName] = useState('');
  const [equipmentId, setEquipmentId] = useState('');
  const [assetDescription, setAssetDescription] = useState('');
  const [type, setType] = useState('CORRECTIVE');
  const [problemReport, setProblemReport] = useState('');
  const [diagnosis, setDiagnosis] = useState('');
  const [internalNotes, setInternalNotes] = useState('');
  const [assignedToId, setAssignedToId] = useState('');
  const [promisedAt, setPromisedAt] = useState('');
  const [depositAmount, setDepositAmount] = useState('0');
  const [checklist, setChecklist] = useState<Array<{ label: string; checked: boolean }>>([
    { label: 'Aparelho ligado na entrada', checked: false },
    { label: 'Acessórios conferidos', checked: false },
    { label: 'Senha/desbloqueio anotado', checked: false },
  ]);
  const [items, setItems] = useState<DraftItem[]>([]);
  const [productSearchOpen, setProductSearchOpen] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [equipFormOpen, setEquipFormOpen] = useState(false);
  const [equipEditingId, setEquipEditingId] = useState<string | null>(null);
  const [eqLabel, setEqLabel] = useState('');
  const [eqSerial, setEqSerial] = useState('');
  const [eqBrand, setEqBrand] = useState('');
  const [eqModel, setEqModel] = useState('');
  const [equipFilter, setEquipFilter] = useState('');
  const [dragOsId, setDragOsId] = useState<string | null>(null);
  const [dragOverCol, setDragOverCol] = useState<OsStatus | null>(null);

  const [payMethod, setPayMethod] = useState('CASH');
  const [payAmount, setPayAmount] = useState('');

  const companyQ = useQuery({
    queryKey: ['company'],
    queryFn: () =>
      api<{
        serviceOrderModuleEnabled?: boolean;
        serviceOrderDefaultBillingMode?: string;
        serviceOrderAllowQuote?: boolean;
      }>('/company'),
  });

  const companyEnabled = companyQ.data?.serviceOrderModuleEnabled === true;
  const billingMode = companyQ.data?.serviceOrderDefaultBillingMode ?? 'CHOICE_PER_ORDER';

  const listQ = useQuery({
    queryKey: ['service-orders', { status, from, to }],
    queryFn: () => {
      const qs = new URLSearchParams();
      if (status && status !== 'ALL') qs.set('status', status);
      if (from) qs.set('from', from);
      if (to) qs.set('to', to);
      qs.set('take', '200');
      return api<OsRow[]>(`/service-orders?${qs}`);
    },
    enabled: moduleOk && companyEnabled,
  });

  const searchQ = useQuery({
    queryKey: ['service-orders', 'search', q],
    queryFn: () => api<OsRow[]>(`/service-orders/search?q=${encodeURIComponent(q)}`),
    enabled: moduleOk && companyEnabled && q.trim().length >= 1,
  });

  const detailQ = useQuery({
    queryKey: ['service-orders', detailId],
    queryFn: () => api<OsRow>(`/service-orders/${detailId}`),
    enabled: Boolean(detailId),
  });

  const customersQ = useQuery({
    queryKey: ['customers', 'search', customerQ],
    queryFn: () => api<CustomerHit[]>(`/customers/search?q=${encodeURIComponent(customerQ)}`),
    enabled: formOpen && !editingId && !customerId && customerQ.trim().length >= 2,
  });

  const equipmentQ = useQuery({
    queryKey: ['service-orders', 'equipment', customerId],
    queryFn: () =>
      api<Equipment[]>(`/service-orders/equipment?customerId=${encodeURIComponent(customerId)}`),
    enabled: formOpen && Boolean(customerId),
  });

  const usersQ = useQuery({
    queryKey: ['service-orders', 'assignees'],
    queryFn: () => api<UserRow[]>('/service-orders/assignees'),
    enabled: formOpen || Boolean(detailId),
    staleTime: 60_000,
  });

  const rows = useMemo(() => {
    const base = q.trim().length >= 1 ? searchQ.data ?? [] : listQ.data ?? [];
    return base;
  }, [listQ.data, searchQ.data, q]);

  const resetForm = () => {
    setEditingId(null);
    setCustomerQ('');
    setCustomerId('');
    setCustomerName('');
    setEquipmentId('');
    setAssetDescription('');
    setType('CORRECTIVE');
    setProblemReport('');
    setDiagnosis('');
    setInternalNotes('');
    setAssignedToId('');
    setPromisedAt('');
    setDepositAmount('0');
    setChecklist([
      { label: 'Aparelho ligado na entrada', checked: false },
      { label: 'Acessórios conferidos', checked: false },
      { label: 'Senha/desbloqueio anotado', checked: false },
    ]);
    setItems([]);
    setErr(null);
    setEquipFormOpen(false);
    setEquipEditingId(null);
    setEqLabel('');
    setEqSerial('');
    setEqBrand('');
    setEqModel('');
    setEquipFilter('');
  };

  const openCreate = () => {
    resetForm();
    setFormOpen(true);
  };

  const openEdit = async (id: string) => {
    setErr(null);
    const row = await api<OsRow>(`/service-orders/${id}`);
    setEditingId(row.id);
    setCustomerId(row.customer.id);
    setCustomerName(row.customer.name);
    setCustomerQ(row.customer.name);
    setEquipmentId(row.equipment?.id ?? '');
    setAssetDescription(row.assetDescription ?? '');
    setType(row.type);
    setProblemReport(row.problemReport ?? '');
    setDiagnosis(row.diagnosis ?? '');
    setInternalNotes(row.internalNotes ?? '');
    setAssignedToId(row.assignedTo?.id ?? '');
    setPromisedAt(row.promisedAt ? row.promisedAt.slice(0, 10) : '');
    setDepositAmount(String(row.depositAmount ?? '0'));
    setChecklist(
      Array.isArray(row.intakeChecklist) && row.intakeChecklist.length
        ? row.intakeChecklist.map((c) => ({ label: c.label, checked: Boolean(c.checked) }))
        : [
            { label: 'Aparelho ligado na entrada', checked: false },
            { label: 'Acessórios conferidos', checked: false },
            { label: 'Senha/desbloqueio anotado', checked: false },
          ],
    );
    setItems(
      row.items.map((it, i) => ({
        key: it.id ?? `i-${i}`,
        kind: it.kind,
        variantId: it.variantId,
        productName: it.variant?.product.name ?? it.description ?? 'Item',
        description: it.description ?? '',
        quantity: String(it.quantity),
        unitPrice: String(it.unitPrice),
        discount: String(it.discount ?? '0'),
      })),
    );
    setFormOpen(true);
  };

  const saveMut = useMutation({
    mutationFn: async () => {
      if (!customerId) throw new Error('Selecione o cliente.');
      const payload = {
        customerId,
        equipmentId: equipmentId || null,
        assetDescription: assetDescription || null,
        type,
        problemReport: problemReport || null,
        diagnosis: diagnosis || null,
        internalNotes: internalNotes || null,
        assignedToId: assignedToId || null,
        promisedAt: promisedAt || null,
        depositAmount: depositAmount || '0',
        intakeChecklist: checklist,
        items: items.map((it) => ({
          kind: it.kind,
          variantId: it.variantId,
          description: it.description || it.productName,
          quantity: it.quantity,
          unitPrice: it.unitPrice,
          discount: it.discount || 0,
        })),
      };
      if (editingId) {
        return api(`/service-orders/${editingId}`, { method: 'PATCH', json: payload });
      }
      return api('/service-orders', { method: 'POST', json: payload });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['service-orders'] });
      setFormOpen(false);
      resetForm();
    },
    onError: (e: Error) => setErr(e.message),
  });

  const statusMut = useMutation({
    mutationFn: ({ id, status: st }: { id: string; status: string }) =>
      api(`/service-orders/${id}/status`, {
        method: 'POST',
        json: { status: st },
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['service-orders'] });
      if (detailId) qc.invalidateQueries({ queryKey: ['service-orders', detailId] });
      setErr(null);
    },
    onError: (e: Error) => setErr(e.message),
  });

  const canMoveTo = (from: OsStatus, to: OsStatus) => {
    if (from === to) return false;
    return (NEXT_STATUS[from] ?? []).includes(to);
  };

  const onKanbanDrop = (toStatus: OsStatus) => {
    if (!dragOsId) return;
    const row = rows.find((r) => r.id === dragOsId);
    setDragOsId(null);
    setDragOverCol(null);
    if (!row || row.status === toStatus) return;
    if (!canMoveTo(row.status, toStatus)) {
      setErr(`Não é permitido mover de ${STATUS_LABEL[row.status]} para ${STATUS_LABEL[toStatus]}.`);
      return;
    }
    statusMut.mutate({ id: row.id, status: toStatus });
  };

  const consumeMut = useMutation({
    mutationFn: ({ orderId, itemId }: { orderId: string; itemId: string }) =>
      api(`/service-orders/${orderId}/items/${itemId}/consume`, {
        method: 'POST',
        json: {},
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['service-orders'] });
      if (detailId) qc.invalidateQueries({ queryKey: ['service-orders', detailId] });
    },
  });

  const billMut = useMutation({
    mutationFn: async (id: string) => {
      const preview = await api<{ balanceDue: number; canBill: boolean }>(
        `/service-orders/${id}/billing-preview`,
      );
      if (!preview.canBill) {
        throw new Error('Vincule produtos do catálogo a todos os itens antes de faturar.');
      }
      const amount = Number(payAmount || preview.balanceDue);
      return api(`/service-orders/${id}/bill`, {
        method: 'POST',
        json: {
          payments: [{ method: payMethod, amount }],
        },
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['service-orders'] });
      setBillOpen(false);
      setDetailId(null);
    },
    onError: (e: Error) => setErr(e.message),
  });

  const resetEquipFormFields = () => {
    setEqLabel('');
    setEqSerial('');
    setEqBrand('');
    setEqModel('');
    setEquipEditingId(null);
  };

  const openEquipCreate = () => {
    resetEquipFormFields();
    setEquipFormOpen(true);
    setErr(null);
  };

  const openEquipEdit = (eq: Equipment) => {
    setEquipEditingId(eq.id);
    setEquipmentId(eq.id);
    setEqLabel(eq.label);
    setEqSerial(eq.serialNumber ?? '');
    setEqBrand(eq.brand ?? '');
    setEqModel(eq.model ?? '');
    setEquipFormOpen(true);
    setErr(null);
  };

  const createEquipmentMut = useMutation({
    mutationFn: async () => {
      if (!customerId) throw new Error('Selecione o cliente antes de cadastrar o equipamento.');
      const label = eqLabel.trim();
      if (!label) throw new Error('Informe o nome do equipamento.');
      return api<Equipment>('/service-orders/equipment', {
        method: 'POST',
        json: {
          customerId,
          label,
          serialNumber: eqSerial.trim() || null,
          brand: eqBrand.trim() || null,
          model: eqModel.trim() || null,
        },
      });
    },
    onSuccess: (eq) => {
      qc.invalidateQueries({ queryKey: ['service-orders', 'equipment', customerId] });
      setEquipmentId(eq.id);
      setEquipFormOpen(false);
      resetEquipFormFields();
      setErr(null);
    },
    onError: (e: Error) => setErr(e.message),
  });

  const updateEquipmentMut = useMutation({
    mutationFn: async () => {
      if (!equipEditingId) throw new Error('Nenhum equipamento selecionado para editar.');
      const label = eqLabel.trim();
      if (!label) throw new Error('Informe o nome do equipamento.');
      return api<Equipment>(`/service-orders/equipment/${equipEditingId}`, {
        method: 'PATCH',
        json: {
          label,
          serialNumber: eqSerial.trim() || null,
          brand: eqBrand.trim() || null,
          model: eqModel.trim() || null,
        },
      });
    },
    onSuccess: (eq) => {
      qc.invalidateQueries({ queryKey: ['service-orders', 'equipment', customerId] });
      qc.invalidateQueries({ queryKey: ['service-orders'] });
      setEquipmentId(eq.id);
      setEquipFormOpen(false);
      resetEquipFormFields();
      setErr(null);
    },
    onError: (e: Error) => setErr(e.message),
  });

  const filteredEquipment = useMemo(() => {
    const list = equipmentQ.data ?? [];
    const term = equipFilter.trim().toLowerCase();
    if (!term) return list;
    return list.filter((e) => {
      const hay = [e.label, e.brand, e.model, e.serialNumber, e.plateOrTag]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      return hay.includes(term);
    });
  }, [equipmentQ.data, equipFilter]);

  const addProduct = (p: ProductSearchRow) => {
    const tax = String(p.taxUnit ?? '').trim().toUpperCase();
    const isService =
      Boolean(p.isService) || tax === 'SERV' || tax === 'SERVICO' || tax === 'SERVIÇO';
    setItems((prev) => [
      ...prev,
      {
        key: `${p.variantId}-${Date.now()}`,
        kind: isService ? 'SERVICE' : 'PART',
        variantId: p.variantId,
        productName: p.productName,
        description: p.productName,
        quantity: '1',
        unitPrice: String(p.retailPrice ?? 0),
        discount: '0',
      },
    ]);
    setProductSearchOpen(false);
  };

  if (!moduleOk) {
    return (
      <div className="page">
        <h1>Ordens de Serviço</h1>
        <p className="muted">
          Módulo não contratado. Solicite ao suporte GestorVend a liberação do adicional{' '}
          <strong>Ordem de Serviços</strong> no portal de licenças.
        </p>
      </div>
    );
  }

  if (companyQ.isSuccess && !companyEnabled) {
    return (
      <div className="page">
        <h1>Ordens de Serviço</h1>
        <p className="muted">
          Módulo contratado, mas desativado neste estabelecimento. Ative em{' '}
          <Link to="/empresa">Empresa → Ordem de Serviços</Link>.
        </p>
      </div>
    );
  }

  const activeKanbanCols: OsStatus[] = [
    'QUOTE',
    'APPROVED',
    'IN_PROGRESS',
    'WAITING_PARTS',
    'READY',
  ];
  /** Kanban = fluxo em aberto; encerradas ficam na Lista (salvo filtro explícito). */
  const closedStatuses = new Set<OsStatus>(['DELIVERED', 'BILLED', 'CANCELLED']);
  const kanbanCols =
    status !== 'ALL' && closedStatuses.has(status as OsStatus)
      ? [status as OsStatus]
      : activeKanbanCols;
  const kanbanRows =
    status === 'ALL' ? rows.filter((r) => !closedStatuses.has(r.status)) : rows;

  return (
    <div className="page">
      <h1>Ordens de Serviço</h1>
      <p className="page-desc">
        Abertura, execução, consumo de peças e faturamento (PDV ou interno). Requer addon no portal e
        ativação em Empresa.
      </p>

      <CrudToolbar
        onInclude={menu.canCreate('serviceOrders') ? openCreate : undefined}
        onReports={() => setReportsOpen(true)}
      />

      <ModuleReportsModal open={reportsOpen} title="Ordens de Serviço" onClose={() => setReportsOpen(false)} compactLauncher>
        <ul style={{ margin: 0, paddingLeft: '1.2rem' }}>
          <li>
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => { setReportsOpen(false); navigate('/ordens-servico/impressao'); }}>
              Espelho / impressão (informe a OS)
            </button>
          </li>
          <li style={{ marginTop: '0.5rem' }}>
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => { setReportsOpen(false); navigate('/ordens-servico/impressao?report=summary'); }}>
              Serviços realizados e aging
            </button>
          </li>
        </ul>
      </ModuleReportsModal>

      <div className="card" style={{ marginBottom: '1rem' }}>
        <div className="form-row">
          <div className="field" style={{ flex: '1.4', minWidth: '12rem' }}>
            <label>Buscar</label>
            <input
              placeholder="Buscar #OS, cliente, serial…"
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
          </div>
          <div className="field">
            <label>Status</label>
            <select value={status} onChange={(e) => setStatus(e.target.value)}>
              <option value="ALL">Todos status</option>
              {Object.entries(STATUS_LABEL).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label>De</label>
            <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
          </div>
          <div className="field">
            <label>Até</label>
            <input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
          </div>
          <div className="field" style={{ justifyContent: 'flex-end' }}>
            <label>&nbsp;</label>
            <div style={{ display: 'flex', gap: '0.35rem' }}>
              <button
                type="button"
                className={`btn btn-secondary ${viewMode === 'list' ? 'is-active' : ''}`}
                onClick={() => setViewMode('list')}
              >
                Lista
              </button>
              <button
                type="button"
                className={`btn btn-secondary ${viewMode === 'kanban' ? 'is-active' : ''}`}
                onClick={() => setViewMode('kanban')}
              >
                Kanban
              </button>
            </div>
          </div>
        </div>
      </div>

      {(listQ.isError || searchQ.isError) && (
        <div className="alert alert-error">
          {(listQ.error as Error)?.message ?? (searchQ.error as Error)?.message}
        </div>
      )}

      {viewMode === 'list' ? (
        <div className="card" style={{ overflowX: 'auto' }}>
          <table className="data-table">
            <thead>
              <tr>
                <th>#</th>
                <th>Abertura</th>
                <th>Cliente</th>
                <th>Equipamento</th>
                <th>Status</th>
                <th>Técnico</th>
                <th className="num" title="Soma de peças + serviços + mão de obra">
                  Total itens
                </th>
                <th className="num" title="Pagamento adiantado">
                  Sinal
                </th>
                <th className="num" title="Total itens − sinal (mín. 0)">
                  Saldo
                </th>
                <th />
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td>#{r.number}</td>
                  <td>{new Date(r.openedAt).toLocaleString('pt-BR')}</td>
                  <td>{r.customer.name}</td>
                  <td>
                    {r.equipment?.label ?? r.assetDescription ?? '—'}
                    {r.equipment?.serialNumber ? ` · ${r.equipment.serialNumber}` : ''}
                  </td>
                  <td>
                    <span className="badge">{STATUS_LABEL[r.status] ?? r.status}</span>
                  </td>
                  <td>{r.assignedTo?.name ?? '—'}</td>
                  <td className="num">{money(r.itemsTotal)}</td>
                  <td className="num">{money(r.depositAmount)}</td>
                  <td className="num">{money(r.balanceDue)}</td>
                  <td style={{ whiteSpace: 'nowrap' }}>
                    <button type="button" className="btn btn-secondary btn-sm" onClick={() => setDetailId(r.id)}>
                      Abrir
                    </button>{' '}
                    <button
                      type="button"
                      className="btn btn-secondary btn-sm"
                      onClick={() => navigate(`/ordens-servico/impressao?id=${r.id}`)}
                    >
                      Espelho
                    </button>{' '}
                    <button
                      type="button"
                      className="btn btn-secondary btn-sm"
                      onClick={() => navigate(`/ordens-servico/impressao?id=${r.id}&view=tech`)}
                    >
                      Técnico
                    </button>
                  </td>
                </tr>
              ))}
              {!rows.length && !listQ.isLoading && (
                <tr>
                  <td colSpan={10} className="muted">
                    Nenhuma OS encontrada.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="os-kanban">
          {err && !formOpen && !detailId ? (
            <div className="alert alert-error" style={{ gridColumn: '1 / -1' }}>
              {err}
            </div>
          ) : null}
          {kanbanCols.map((col) => (
            <div
              key={col}
              className={`card os-kanban__col${dragOverCol === col ? ' is-drop-target' : ''}`}
              onDragOver={(e) => {
                e.preventDefault();
                e.dataTransfer.dropEffect = 'move';
                setDragOverCol(col);
              }}
              onDragLeave={() => setDragOverCol((c) => (c === col ? null : c))}
              onDrop={(e) => {
                e.preventDefault();
                onKanbanDrop(col);
              }}
            >
              <strong className="os-kanban__col-title">{STATUS_LABEL[col]}</strong>
              <div className="os-kanban__cards">
                {kanbanRows
                  .filter((r) => r.status === col)
                  .map((r) => (
                    <div
                      key={r.id}
                      className={`os-kanban__card${dragOsId === r.id ? ' is-dragging' : ''}`}
                      draggable
                      onDragStart={(e) => {
                        setDragOsId(r.id);
                        e.dataTransfer.setData('text/plain', r.id);
                        e.dataTransfer.effectAllowed = 'move';
                      }}
                      onDragEnd={() => {
                        setDragOsId(null);
                        setDragOverCol(null);
                      }}
                    >
                      <button
                        type="button"
                        className="os-kanban__card-open"
                        onClick={() => setDetailId(r.id)}
                      >
                        <div className="os-kanban__card-num">#{r.number}</div>
                        <div className="os-kanban__card-name">{r.customer.name}</div>
                        <div className="os-kanban__card-meta">
                          {money(r.itemsTotal)}
                          {Number(r.depositAmount) > 0 ? ` · sinal ${money(r.depositAmount)}` : ''}
                        </div>
                      </button>
                    </div>
                  ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {formOpen && (
        <FormModalBackdrop onClose={() => setFormOpen(false)}>
          <div
            className="modal modal--wide service-order-form-modal"
            role="dialog"
            onClick={(e) => e.stopPropagation()}
          >
          <h2>{editingId ? 'Editar OS' : 'Nova OS'}</h2>
          {err && <div className="alert alert-error">{err}</div>}
          <div className="form-row">
            <div className="field" style={{ position: 'relative', flex: 1.4 }}>
              <label>Cliente *</label>
              <input
                value={customerQ}
                onChange={(e) => {
                  setCustomerQ(e.target.value);
                  setCustomerId('');
                  setCustomerName('');
                  setEquipmentId('');
                  setEquipFormOpen(false);
                  resetEquipFormFields();
                  setEquipFilter('');
                }}
                placeholder="Buscar cliente…"
                disabled={Boolean(editingId)}
              />
              {!editingId && !customerId && customersQ.data?.length ? (
                <ul className="suggest-list" role="listbox">
                  {customersQ.data.slice(0, 8).map((c) => (
                    <li key={c.id}>
                      <button
                        type="button"
                        role="option"
                        onClick={() => {
                          setCustomerId(c.id);
                          setCustomerName(c.name);
                          setCustomerQ(c.name);
                          setEquipmentId('');
                          setEquipFormOpen(false);
                          resetEquipFormFields();
                          setEquipFilter('');
                        }}
                      >
                        {c.name}
                        {c.document ? (
                          <span className="suggest-list__meta"> · {c.document}</span>
                        ) : null}
                      </button>
                    </li>
                  ))}
                </ul>
              ) : null}
              {customerId && customerName ? (
                <p className="muted" style={{ margin: '0.25rem 0 0' }}>
                  Selecionado: {customerName}
                </p>
              ) : null}
            </div>
            <div className="field">
              <label>Tipo</label>
              <select value={type} onChange={(e) => setType(e.target.value)}>
                {Object.entries(TYPE_LABEL).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="field">
            <label>Equipamento</label>
            <div className="service-order-equip-row">
              <select
                value={equipmentId}
                onChange={(e) => {
                  setEquipmentId(e.target.value);
                  if (equipFormOpen && equipEditingId && e.target.value !== equipEditingId) {
                    setEquipFormOpen(false);
                    resetEquipFormFields();
                  }
                }}
                disabled={!customerId}
              >
                <option value="">— Sem equipamento —</option>
                {(equipmentQ.data ?? []).map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.label}
                    {e.serialNumber ? ` (${e.serialNumber})` : ''}
                  </option>
                ))}
              </select>
              <button
                type="button"
                className="btn btn-secondary"
                title={customerId ? 'Cadastrar equipamento' : 'Selecione o cliente primeiro'}
                disabled={!customerId}
                onClick={openEquipCreate}
              >
                +
              </button>
            </div>
            {!customerId ? (
              <p className="service-order-equip-hint">
                Selecione o cliente para escolher, editar ou cadastrar equipamento.
              </p>
            ) : (
              <div className="service-order-equip-list">
                <input
                  className="service-order-equip-search"
                  placeholder="Pesquisar equipamento do cliente…"
                  value={equipFilter}
                  onChange={(e) => setEquipFilter(e.target.value)}
                />
                {filteredEquipment.length ? (
                  <ul className="suggest-list service-order-equip-suggest" role="listbox">
                    {filteredEquipment.slice(0, 12).map((eq) => (
                      <li key={eq.id}>
                        <button
                          type="button"
                          role="option"
                          className={equipmentId === eq.id ? 'is-selected' : undefined}
                          onClick={() => setEquipmentId(eq.id)}
                        >
                          {eq.label}
                          {eq.serialNumber ? (
                            <span className="suggest-list__meta"> · {eq.serialNumber}</span>
                          ) : null}
                          {eq.brand || eq.model ? (
                            <span className="suggest-list__meta">
                              {' '}
                              · {[eq.brand, eq.model].filter(Boolean).join(' ')}
                            </span>
                          ) : null}
                        </button>
                        <button
                          type="button"
                          className="btn btn-secondary btn-sm"
                          title="Editar equipamento"
                          onClick={() => openEquipEdit(eq)}
                        >
                          Editar
                        </button>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="service-order-equip-hint">
                    {equipFilter.trim()
                      ? 'Nenhum equipamento encontrado nesta pesquisa.'
                      : 'Nenhum equipamento cadastrado para este cliente.'}
                  </p>
                )}
              </div>
            )}
            {equipFormOpen && customerId ? (
              <div className="service-order-equip-panel">
                <p style={{ margin: '0 0 0.45rem', fontWeight: 600, fontSize: '0.88rem' }}>
                  {equipEditingId ? 'Editar equipamento' : 'Novo equipamento'}
                </p>
                <div className="form-row">
                  <div className="field" style={{ flex: 1.3 }}>
                    <label>Nome *</label>
                    <input
                      value={eqLabel}
                      onChange={(e) => setEqLabel(e.target.value)}
                      placeholder="Ex.: TV led 14pol"
                      autoFocus
                    />
                  </div>
                  <div className="field">
                    <label>Serial</label>
                    <input value={eqSerial} onChange={(e) => setEqSerial(e.target.value)} />
                  </div>
                </div>
                <div className="form-row">
                  <div className="field">
                    <label>Marca</label>
                    <input value={eqBrand} onChange={(e) => setEqBrand(e.target.value)} />
                  </div>
                  <div className="field">
                    <label>Modelo</label>
                    <input value={eqModel} onChange={(e) => setEqModel(e.target.value)} />
                  </div>
                </div>
                <div style={{ display: 'flex', gap: '0.35rem', justifyContent: 'flex-end' }}>
                  <button
                    type="button"
                    className="btn btn-secondary btn-sm"
                    onClick={() => {
                      setEquipFormOpen(false);
                      resetEquipFormFields();
                    }}
                  >
                    Cancelar
                  </button>
                  <button
                    type="button"
                    className="btn btn-primary btn-sm"
                    disabled={createEquipmentMut.isPending || updateEquipmentMut.isPending}
                    onClick={() =>
                      equipEditingId ? updateEquipmentMut.mutate() : createEquipmentMut.mutate()
                    }
                  >
                    {equipEditingId ? 'Salvar alterações' : 'Salvar equipamento'}
                  </button>
                </div>
              </div>
            ) : null}
          </div>

          <div className="form-row">
            <div className="field" style={{ flex: 1.2 }}>
              <label>Descrição do bem (se sem cadastro)</label>
              <input value={assetDescription} onChange={(e) => setAssetDescription(e.target.value)} />
            </div>
            <div className="field">
              <label>Técnico</label>
              <select value={assignedToId} onChange={(e) => setAssignedToId(e.target.value)}>
                <option value="">—</option>
                {(usersQ.data ?? [])
                  .filter((u) => u.isActive)
                  .map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.name}
                    </option>
                  ))}
              </select>
            </div>
            <div className="field">
              <label>Prazo</label>
              <input type="date" value={promisedAt} onChange={(e) => setPromisedAt(e.target.value)} />
            </div>
            <div className="field">
              <label>Sinal (R$)</label>
              <input
                value={depositAmount}
                onChange={(e) => setDepositAmount(e.target.value)}
                placeholder="0,00"
              />
            </div>
          </div>

          <div className="form-row">
            <div className="field">
              <label>Defeito / solicitação</label>
              <textarea value={problemReport} onChange={(e) => setProblemReport(e.target.value)} rows={2} />
            </div>
            <div className="field">
              <label>Diagnóstico</label>
              <textarea value={diagnosis} onChange={(e) => setDiagnosis(e.target.value)} rows={2} />
            </div>
          </div>
          <div className="field">
            <label>Notas internas</label>
            <textarea value={internalNotes} onChange={(e) => setInternalNotes(e.target.value)} rows={2} />
          </div>
          <div className="field">
            <label>Checklist de entrada</label>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.35rem 1rem' }}>
              {checklist.map((c, idx) => (
                <label key={idx} style={{ display: 'flex', gap: '0.35rem', alignItems: 'center', fontSize: '0.88rem' }}>
                  <input
                    type="checkbox"
                    checked={c.checked}
                    onChange={(e) => {
                      const next = [...checklist];
                      next[idx] = { ...c, checked: e.target.checked };
                      setChecklist(next);
                    }}
                  />
                  {c.label}
                </label>
              ))}
            </div>
          </div>

          <div style={{ marginTop: '0.35rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
              <strong>Itens (peças + serviços)</strong>
              <button type="button" className="btn btn-secondary btn-sm" onClick={() => setProductSearchOpen(true)}>
                + Produto/serviço
              </button>
            </div>
            <p className="muted" style={{ margin: '0.25rem 0 0', fontSize: '0.78rem' }}>
              O total da OS é a soma destas linhas. Cadastre serviços no catálogo com unidade{' '}
              <strong>SERV</strong> e inclua-os aqui (necessário para faturar).
            </p>
            <div style={{ overflowX: 'auto' }}>
            <table className="data-table" style={{ marginTop: '0.35rem' }}>
              <thead>
                <tr>
                  <th>Item</th>
                  <th>Tipo</th>
                  <th className="num">Qtd</th>
                  <th className="num">Preço</th>
                  <th className="num">Desc.</th>
                  <th className="num">Total</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {items.map((it) => (
                  <tr key={it.key}>
                    <td>
                      {it.variantId ? (
                        it.productName
                      ) : (
                        <input
                          value={it.description || it.productName}
                          onChange={(e) =>
                            setItems((prev) =>
                              prev.map((x) =>
                                x.key === it.key
                                  ? {
                                      ...x,
                                      description: e.target.value,
                                      productName: e.target.value || x.productName,
                                    }
                                  : x,
                              ),
                            )
                          }
                          placeholder="Descrição do serviço"
                          style={{ minWidth: '10rem', width: '100%' }}
                        />
                      )}
                    </td>
                    <td>
                      <select
                        value={it.kind}
                        onChange={(e) =>
                          setItems((prev) =>
                            prev.map((x) => (x.key === it.key ? { ...x, kind: e.target.value } : x)),
                          )
                        }
                      >
                        <option value="PART">Peça</option>
                        <option value="SERVICE">Serviço</option>
                        <option value="LABOR">Mão de obra</option>
                        <option value="OTHER">Outro</option>
                      </select>
                    </td>
                    <td className="num">
                      <input
                        value={it.quantity}
                        onChange={(e) =>
                          setItems((prev) =>
                            prev.map((x) => (x.key === it.key ? { ...x, quantity: e.target.value } : x)),
                          )
                        }
                        style={{ width: '4rem' }}
                      />
                    </td>
                    <td className="num">
                      <input
                        value={it.unitPrice}
                        onChange={(e) =>
                          setItems((prev) =>
                            prev.map((x) => (x.key === it.key ? { ...x, unitPrice: e.target.value } : x)),
                          )
                        }
                        style={{ width: '5rem' }}
                      />
                    </td>
                    <td className="num">
                      <input
                        value={it.discount}
                        onChange={(e) =>
                          setItems((prev) =>
                            prev.map((x) => (x.key === it.key ? { ...x, discount: e.target.value } : x)),
                          )
                        }
                        style={{ width: '4rem' }}
                      />
                    </td>
                    <td className="num">{money(lineTotal(it))}</td>
                    <td>
                      <button
                        type="button"
                        className="btn btn-secondary btn-sm"
                        onClick={() => setItems((prev) => prev.filter((x) => x.key !== it.key))}
                      >
                        Remover
                      </button>
                    </td>
                  </tr>
                ))}
                {!items.length ? (
                  <tr>
                    <td colSpan={7} className="muted">
                      Nenhum item. Peças/serviços podem ser adicionados agora ou depois.
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
            </div>
            <p style={{ textAlign: 'right', fontWeight: 700, margin: '0.35rem 0 0' }}>
              Total: {money(items.reduce((s, it) => s + lineTotal(it), 0))}
            </p>
          </div>

          <div className="modal-actions">
            <button type="button" className="btn btn-secondary" onClick={() => setFormOpen(false)}>
              Cancelar
            </button>
            <button
              type="button"
              className="btn btn-primary"
              disabled={saveMut.isPending}
              onClick={() => saveMut.mutate()}
            >
              Salvar
            </button>
          </div>
          </div>
        </FormModalBackdrop>
      )}

      {detailId && detailQ.data && (
        <FormModalBackdrop onClose={() => setDetailId(null)}>
          <div className="modal modal--wide" role="dialog" onClick={(e) => e.stopPropagation()}>
          <h2>
            OS #{detailQ.data.number}{' '}
            <span className="badge">{STATUS_LABEL[detailQ.data.status]}</span>
          </h2>
          {err && <div className="alert alert-error">{err}</div>}
          <p>
            <strong>{detailQ.data.customer.name}</strong>
            {detailQ.data.equipment ? ` · ${detailQ.data.equipment.label}` : null}
          </p>
          <p className="muted">{detailQ.data.problemReport || '—'}</p>
          {detailQ.data.diagnosis ? (
            <p>
              <strong>Diagnóstico / executado:</strong> {detailQ.data.diagnosis}
            </p>
          ) : null}
          <p>
            Total itens {money(detailQ.data.itemsTotal)} · Sinal {money(detailQ.data.depositAmount)} · Saldo{' '}
            {money(detailQ.data.balanceDue)}
            {(detailQ.data.depositCredit ?? 0) > 0 ? (
              <> · Crédito de sinal {money(detailQ.data.depositCredit!)}</>
            ) : null}
          </p>
          <p className="muted" style={{ fontSize: '0.78rem', marginTop: '-0.35rem' }}>
            Saldo = total dos itens − sinal (mínimo R$ 0). Se o sinal for maior, a sobra aparece como crédito de sinal.
          </p>

          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.35rem', marginBottom: '0.75rem' }}>
            {(NEXT_STATUS[detailQ.data.status] ?? []).map((st) => (
              <button
                key={st}
                type="button"
                className="btn btn-secondary btn-sm"
                onClick={() => statusMut.mutate({ id: detailQ.data!.id, status: st })}
              >
                → {STATUS_LABEL[st]}
              </button>
            ))}
            {menu.canUpdate('serviceOrders') &&
            detailQ.data.status !== 'BILLED' &&
            detailQ.data.status !== 'CANCELLED' ? (
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                onClick={() => {
                  const id = detailQ.data!.id;
                  setDetailId(null);
                  void openEdit(id);
                }}
              >
                Editar
              </button>
            ) : null}
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={() => navigate(`/ordens-servico/impressao?id=${detailQ.data!.id}`)}
            >
              Espelho
            </button>
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={() => navigate(`/ordens-servico/impressao?id=${detailQ.data!.id}&view=tech`)}
            >
              Via técnico
            </button>
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={() =>
                navigate(`/ordens-servico/impressao?id=${detailQ.data!.id}&view=history`)
              }
            >
              Histórico
            </button>
            {(detailQ.data.status === 'READY' || detailQ.data.status === 'DELIVERED') &&
            !detailQ.data.sale ? (
              <>
                {(billingMode === 'INTERNAL' || billingMode === 'CHOICE_PER_ORDER') && (
                  <button
                    type="button"
                    className="btn btn-primary btn-sm"
                    onClick={() => {
                      setPayAmount(String(detailQ.data!.balanceDue));
                      setBillOpen(true);
                      setErr(null);
                    }}
                  >
                    Faturar
                  </button>
                )}
                {(billingMode === 'PDV' || billingMode === 'CHOICE_PER_ORDER') && (
                  <button
                    type="button"
                    className="btn btn-secondary btn-sm"
                    onClick={() => navigate(`/vendas?os=${detailQ.data!.number}`)}
                  >
                    Abrir no PDV
                  </button>
                )}
              </>
            ) : null}
          </div>

          <table className="data-table">
            <thead>
              <tr>
                <th>Item</th>
                <th>Tipo</th>
                <th className="num">Qtd</th>
                <th className="num">Total</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {detailQ.data.items.map((it) => (
                <tr key={it.id}>
                  <td>{it.variant?.product.name ?? it.description}</td>
                  <td>{it.kind}</td>
                  <td className="num">{it.quantity}</td>
                  <td className="num">{money(it.totalLine)}</td>
                  <td>
                    {it.kind === 'PART' && it.variantId && !it.consumedAt && detailQ.data!.status !== 'BILLED' ? (
                      <button
                        type="button"
                        className="btn btn-secondary btn-sm"
                        onClick={() =>
                          consumeMut.mutate({ orderId: detailQ.data!.id, itemId: it.id! })
                        }
                      >
                        Consumir estoque
                      </button>
                    ) : it.consumedAt ? (
                      <span className="muted">Consumido</span>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          {detailQ.data.statusHistory?.length ? (
            <div style={{ marginTop: '1rem' }}>
              <strong>Histórico</strong>
              <ul>
                {detailQ.data.statusHistory.map((h) => (
                  <li key={h.id}>
                    {new Date(h.createdAt).toLocaleString('pt-BR')} —{' '}
                    {h.fromStatus ? STATUS_LABEL[h.fromStatus as OsStatus] ?? h.fromStatus : '—'} →{' '}
                    {STATUS_LABEL[h.toStatus as OsStatus] ?? h.toStatus}
                    {h.note ? ` (${h.note})` : ''}
                  </li>
              ))}
            </ul>
          </div>
          ) : null}

          <div className="modal-actions">
            <button type="button" className="btn btn-secondary" onClick={() => setDetailId(null)}>
              Fechar
            </button>
          </div>
          </div>
        </FormModalBackdrop>
      )}

      {billOpen && detailId && (
        <FormModalBackdrop onClose={() => setBillOpen(false)}>
          <div className="modal" role="dialog" onClick={(e) => e.stopPropagation()}>
          <h2>Faturar OS</h2>
          {err && <div className="alert alert-error">{err}</div>}
          <div className="field">
            <label>Forma</label>
            <select value={payMethod} onChange={(e) => setPayMethod(e.target.value)}>
              <option value="CASH">Dinheiro</option>
              <option value="PIX">Pix</option>
              <option value="CARD">Cartão</option>
              <option value="CREDIT">Crédito</option>
              <option value="REQUISITION">Requisição</option>
              <option value="OTHER">Outro</option>
            </select>
          </div>
          <div className="field">
            <label>Valor</label>
            <input value={payAmount} onChange={(e) => setPayAmount(e.target.value)} />
          </div>
          <div className="modal-actions">
            <button type="button" className="btn btn-secondary" onClick={() => setBillOpen(false)}>
              Cancelar
            </button>
            <button
              type="button"
              className="btn btn-primary"
              disabled={billMut.isPending}
              onClick={() => billMut.mutate(detailId)}
            >
              Confirmar
            </button>
          </div>
          </div>
        </FormModalBackdrop>
      )}

      <ProductSearchModal
        open={productSearchOpen}
        onClose={() => setProductSearchOpen(false)}
        onPick={(row) => addProduct(row)}
      />

      {/* reports modal already above */}
    </div>
  );
}
