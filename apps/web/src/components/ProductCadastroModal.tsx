/**
 * Edição fiscal do produto por cima da nota (NCM, situação, origem).
 * No Desktop, window.open não recebe o clique do formulário.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { FiscalCodeSearchCombo, FISCAL_ORIGIN_OPTIONS } from './ProductCatalogCombos';
import { FormModalBackdrop } from './FormModalBackdrop';
import { api } from '../lib/api';

type Product = {
  id: string;
  name: string;
  ncm: string | null;
  cest: string | null;
  exTipi: string | null;
  fiscalOrigin: string | null;
  fiscalSituationId: string | null;
  taxUnit: string | null;
  defaultBarcode: string | null;
};

type FiscalSituation = { id: string; code: string; name: string; isActive: boolean };

export function ProductCadastroModal({
  productId,
  onClose,
  onSaved,
}: {
  productId: string;
  onClose: () => void;
  onSaved?: (product: { id: string; name: string }) => void;
}) {
  const qc = useQueryClient();
  const hydrated = useRef(false);
  const [name, setName] = useState('');
  const [ncm, setNcm] = useState('');
  const [cest, setCest] = useState('');
  const [exTipi, setExTipi] = useState('');
  const [fiscalOrigin, setFiscalOrigin] = useState('');
  const [fiscalSituationId, setFiscalSituationId] = useState('');
  const [taxUnit, setTaxUnit] = useState('UN');
  const [barcode, setBarcode] = useState('');
  const [err, setErr] = useState<string | null>(null);

  const detail = useQuery({
    queryKey: ['products', productId, 'note-cadastro'],
    queryFn: () => api<Product>(`/products/${productId}`),
  });

  const situations = useQuery({
    queryKey: ['fiscal-situations'],
    queryFn: () => api<FiscalSituation[]>('/fiscal-situations'),
  });

  useEffect(() => {
    const p = detail.data;
    if (!p || hydrated.current) return;
    hydrated.current = true;
    setName(p.name);
    setNcm(p.ncm ?? '');
    setCest(p.cest ?? '');
    setExTipi(p.exTipi ?? '');
    setFiscalOrigin(p.fiscalOrigin ?? '');
    setFiscalSituationId(p.fiscalSituationId ?? '');
    setTaxUnit(p.taxUnit?.trim() || 'UN');
    setBarcode(p.defaultBarcode ?? '');
  }, [detail.data]);

  const save = useMutation({
    mutationFn: () => {
      if (!name.trim()) throw new Error('Informe o nome do produto.');
      const ncmDigits = ncm.replace(/\D/g, '');
      if (ncmDigits && ncmDigits.length !== 8) throw new Error('NCM precisa ter 8 dígitos.');
      const cestDigits = cest.replace(/\D/g, '');
      if (cestDigits && cestDigits.length !== 7) throw new Error('CEST precisa ter 7 dígitos.');
      return api<Product>(`/products/${productId}`, {
        method: 'PATCH',
        json: {
          name: name.trim(),
          ncm: ncmDigits || null,
          cest: cestDigits || null,
          exTipi: exTipi.trim() || null,
          fiscalOrigin: fiscalOrigin || null,
          fiscalSituationId: fiscalSituationId || null,
          taxUnit: taxUnit.trim() || 'UN',
          defaultBarcode: barcode.trim() || null,
        },
      });
    },
    onSuccess: (saved) => {
      void qc.invalidateQueries({ queryKey: ['products'] });
      onSaved?.({ id: saved.id, name: saved.name });
      onClose();
    },
    onError: (e: Error) => setErr(e.message),
  });

  return (
    <FormModalBackdrop className="modal-backdrop--nested modal-backdrop--cadastro" onClose={onClose}>
      <div className="modal form-cadastro-modal" role="dialog" aria-labelledby="note-product-cadastro-title">
        <h2 id="note-product-cadastro-title">Cadastro do produto</h2>
        <p className="page-desc" style={{ marginTop: 0 }}>
          Nome, NCM e situação fiscal usados na nota. Salve aqui e reenvie.
        </p>
        {detail.isError ? (
          <div className="alert alert-error">{(detail.error as Error).message}</div>
        ) : null}
        {err ? <div className="alert alert-error">{err}</div> : null}
        {detail.isPending ? (
          <p>Carregando cadastro…</p>
        ) : (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              setErr(null);
              save.mutate();
            }}
          >
            <div className="field">
              <label htmlFor="note-prod-name">Nome *</label>
              <input id="note-prod-name" value={name} onChange={(e) => setName(e.target.value)} required />
            </div>
            <div className="field">
              <label htmlFor="note-prod-sit">Situação fiscal</label>
              <select
                id="note-prod-sit"
                value={fiscalSituationId}
                onChange={(e) => setFiscalSituationId(e.target.value)}
              >
                <option value="">— Sem situação fiscal —</option>
                {(situations.data ?? [])
                  .filter((s) => s.isActive)
                  .map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.code} — {s.name}
                    </option>
                  ))}
              </select>
            </div>
            <div className="form-row">
              <div className="field">
                <span className="field-label-text">NCM</span>
                <FiscalCodeSearchCombo
                  kind="ncm"
                  id="note-prod-ncm"
                  label="NCM"
                  value={ncm}
                  onChange={setNcm}
                  hintLabel={ncm || null}
                />
              </div>
              <div className="field">
                <span className="field-label-text">CEST</span>
                <FiscalCodeSearchCombo
                  kind="cest"
                  id="note-prod-cest"
                  label="CEST"
                  value={cest}
                  onChange={setCest}
                  hintLabel={cest || null}
                  ncmHint={ncm || null}
                />
              </div>
            </div>
            <div className="form-row">
              <div className="field">
                <label htmlFor="note-prod-extipi">EX TIPI</label>
                <input
                  id="note-prod-extipi"
                  value={exTipi}
                  onChange={(e) => setExTipi(e.target.value)}
                  maxLength={3}
                />
              </div>
              <div className="field">
                <label htmlFor="note-prod-origin">Origem</label>
                <select
                  id="note-prod-origin"
                  value={fiscalOrigin}
                  onChange={(e) => setFiscalOrigin(e.target.value)}
                >
                  <option value="">— Não informado —</option>
                  {FISCAL_ORIGIN_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <div className="form-row">
              <div className="field">
                <span className="field-label-text">Unidade</span>
                <FiscalCodeSearchCombo
                  kind="tax-units"
                  id="note-prod-unit"
                  label="Unidade tributável"
                  value={taxUnit}
                  onChange={setTaxUnit}
                  hintLabel={taxUnit || null}
                />
              </div>
              <div className="field">
                <label htmlFor="note-prod-ean">Código de barras</label>
                <input
                  id="note-prod-ean"
                  value={barcode}
                  onChange={(e) => setBarcode(e.target.value.replace(/\D/g, '').slice(0, 14))}
                  inputMode="numeric"
                  placeholder="Vazio envia SEM GTIN"
                />
              </div>
            </div>
            <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end', marginTop: '0.75rem' }}>
              <button type="button" className="btn btn-secondary" onClick={onClose}>
                Cancelar
              </button>
              <button type="submit" className="btn btn-primary" disabled={save.isPending}>
                {save.isPending ? 'Salvando…' : 'Salvar cadastro'}
              </button>
            </div>
          </form>
        )}
      </div>
    </FormModalBackdrop>
  );
}
