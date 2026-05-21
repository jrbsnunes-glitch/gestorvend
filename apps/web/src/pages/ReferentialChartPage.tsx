import { useQuery } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ReportPrintSticker } from '../components/ReportPrintSticker';
import { api } from '../lib/api';

type RefRow = {
  id: string;
  code: string;
  description: string;
  level: number;
  parentCode: string | null;
  sourceVersion: string;
};

type TreeNode = RefRow & { children: TreeNode[] };

function buildTree(rows: RefRow[]): TreeNode[] {
  const roots: TreeNode[] = [];
  const nodeMap = new Map<string, TreeNode>();

  for (const r of rows) {
    nodeMap.set(r.code, { ...r, children: [] });
  }
  for (const r of rows) {
    const node = nodeMap.get(r.code)!;
    const p = r.parentCode?.trim();
    if (p && nodeMap.has(p)) {
      nodeMap.get(p)!.children.push(node);
    } else {
      roots.push(node);
    }
  }
  function sortRec(nodes: TreeNode[]) {
    nodes.sort((a, b) => a.code.localeCompare(b.code, undefined, { numeric: true }));
    for (const n of nodes) sortRec(n.children);
  }
  sortRec(roots);
  return roots;
}

function exportCsv(rows: RefRow[]) {
  const head = ['code', 'description', 'level', 'parentCode', 'sourceVersion'];
  const lines = rows.map((r) =>
    [r.code, r.description.replaceAll(';', ','), r.level, r.parentCode ?? '', r.sourceVersion]
      .map((c) => `"${String(c).replaceAll('"', '""')}"`)
      .join(';'),
  );
  const blob = new Blob([head.join(';') + '\n' + lines.join('\n')], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'plano-referencial.csv';
  a.click();
  URL.revokeObjectURL(a.href);
}

function TreeList({ nodes, depth = 0 }: { nodes: TreeNode[]; depth?: number }) {
  return (
    <ul style={{ listStyle: 'none', paddingLeft: depth ? '1rem' : 0, margin: 0 }}>
      {nodes.map((n) => (
        <li key={n.id} style={{ margin: '0.25rem 0' }}>
          <span style={{ fontWeight: 600, fontFamily: 'monospace' }}>{n.code}</span>
          <span style={{ marginLeft: '0.5rem' }}>{n.description}</span>
          <span style={{ marginLeft: '0.5rem', color: 'var(--color-text-muted)', fontSize: '0.8rem' }}>
            nív. {n.level}
          </span>
          {n.children.length > 0 && <TreeList nodes={n.children} depth={depth + 1} />}
        </li>
      ))}
    </ul>
  );
}

export function ReferentialChartPage() {
  const [search, setSearch] = useState('');
  const [version, setVersion] = useState('');

  const qs = useMemo(() => {
    const p = new URLSearchParams();
    if (search.trim()) p.set('search', search.trim());
    if (version.trim()) p.set('sourceVersion', version.trim());
    return p.toString();
  }, [search, version]);

  const q = useQuery({
    queryKey: ['financial-overview', 'referential', qs],
    queryFn: () => api<RefRow[]>(`/financial-overview/referential-accounts?${qs}`),
  });

  const rows = q.data ?? [];
  const tree = useMemo(() => buildTree(rows), [rows]);

  const versions = useMemo(() => {
    const s = new Set<string>();
    for (const r of rows) s.add(r.sourceVersion);
    return [...s].sort();
  }, [rows]);

  return (
    <div className="page print-area">
      <ReportPrintSticker documentTitle="Plano de contas referencial" />

      <h1 className="page-title">Plano de contas (referencial)</h1>
      <p className="page-desc">
        Contas importadas conforme versão do arquivo (ex.: layout RFB/ECD). Substituir o JSON de exemplo pelo
        plano oficial ao homologar.{' '}
        <a href="https://www.gov.br/receitafederal/" target="_blank" rel="noreferrer">
          Receita Federal
        </a>
        .
      </p>

      <div className="toolbar" style={{ flexWrap: 'wrap', gap: '0.75rem', alignItems: 'flex-end' }}>
        <div className="field" style={{ marginBottom: 0, minWidth: 200 }}>
          <label htmlFor="coa-search">Buscar</label>
          <input
            id="coa-search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Código ou descrição"
          />
        </div>
        <div className="field" style={{ marginBottom: 0, minWidth: 160 }}>
          <label htmlFor="coa-ver">Versão importada</label>
          <input
            id="coa-ver"
            value={version}
            onChange={(e) => setVersion(e.target.value)}
            placeholder="ex.: RFB-sample-v1"
            list="coa-versions"
          />
          <datalist id="coa-versions">
            {versions.map((v) => (
              <option key={v} value={v} />
            ))}
          </datalist>
        </div>
        <button type="button" className="btn btn-secondary" onClick={() => q.refetch()}>
          Filtrar
        </button>
        <button
          type="button"
          className="btn btn-secondary"
          onClick={() => exportCsv(rows)}
          disabled={!rows.length}
        >
          Exportar CSV
        </button>
        <Link to="/balanco" className="btn btn-secondary">
          Voltar ao balanço
        </Link>
      </div>

      {q.isError && <div className="alert alert-error">{(q.error as Error).message}</div>}
      {q.isLoading && <p style={{ marginTop: '1rem' }}>Carregando…</p>}

      {!q.isLoading && !q.data?.length && (
        <div className="alert alert-error" style={{ marginTop: '1rem' }}>
          Nenhuma conta importada. No servidor, rode{' '}
          <code style={{ whiteSpace: 'pre-wrap' }}>npm run import:referential-accounts</code> em{' '}
          <code>apps/api</code> com <code>TENANT_DATABASE_URL</code>.
        </div>
      )}

      {rows.length > 0 && (
        <div className="card" style={{ marginTop: '1rem', padding: '1rem' }}>
          <h2 style={{ marginTop: 0, fontSize: '1.05rem' }}>Árvore ({rows.length} contas)</h2>
          <TreeList nodes={tree} />
        </div>
      )}
    </div>
  );
}
