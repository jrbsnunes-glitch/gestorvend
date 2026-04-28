export function ModuleReportsModal({
  open,
  title,
  onClose,
  children,
}: {
  open: boolean;
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  if (!open) return null;
  return (
    <div className="modal-backdrop" role="presentation" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h2>Relatórios — {title}</h2>
        <p className="page-desc" style={{ marginBottom: '1rem' }}>
          Relatórios específicos deste módulo. Os itens abaixo serão preenchidos conforme evolução do sistema.
        </p>
        <div className="card" style={{ padding: '1rem' }}>
          {children}
        </div>
        <div className="modal-actions">
          <button type="button" className="btn btn-primary" onClick={onClose}>
            Fechar
          </button>
        </div>
      </div>
    </div>
  );
}
