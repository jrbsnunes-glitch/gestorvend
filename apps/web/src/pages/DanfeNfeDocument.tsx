import { CompanyLogo } from '../components/CompanyLogo';
import { Code128Barcode } from '../lib/code128-barcode';
import { formatBRL, formatCnpj, formatCpfCnpj, formatDate } from '../lib/format';
import { fiscalPaymentLabel } from '../lib/nfce-payment';
import { formatNfceAccessKey } from '../lib/nfce-qr';

export type DanfeNfePayload = {
  preview?: boolean;
  document: {
    status: string;
    accessKey: string | null;
    protocol: string | null;
    sefazEnvironment?: string | null;
    lastError: string | null;
    sale: {
      number: number;
      total: string;
      discount: string;
      surcharge: string;
      freightAmount?: string;
      freightMod?: number;
      deliveryVehiclePlate?: string | null;
      deliveryDriverName?: string | null;
      notes?: string | null;
      createdAt: string;
      customer: {
        name: string;
        document: string | null;
        street?: string | null;
        number?: string | null;
        complement?: string | null;
        district?: string | null;
        city?: string | null;
        state?: string | null;
        zip?: string | null;
        phone?: string | null;
        email?: string | null;
      } | null;
      operationNature?: { code: string; description: string; cfop: string } | null;
      payments?: Array<{
        method: string;
        amount: string;
        cardOperation?: string | null;
        paymentForm?: { name?: string | null } | null;
        tPag?: string | null;
        xPag?: string | null;
        fiscalLabel?: string | null;
      }>;
      items?: Array<{
        quantity: string;
        unitPrice: string;
        totalLine: string;
        variant?: {
          sku?: string;
          product?: {
            name?: string;
            ncm?: string | null;
            taxUnit?: string | null;
            fiscalSituation?: {
              cstIbsCbs?: string | null;
              cClassTrib?: string | null;
              cstIcms?: string | null;
              csosn?: string | null;
              cfopInternal?: string | null;
              cfopInterstate?: string | null;
              aliqIcms?: string | number | null;
            } | null;
          };
        };
      }>;
    };
  };
  nfe?: { serie: number | null; nNF: number | null } | null;
  rtc?: {
    crt: number;
    totals: { cbs: string; ibsUf: string; ibsMun: string; is: string };
  };
  company: {
    legalName: string;
    tradeName: string;
    cnpj: string;
    ie: string | null;
    im?: string | null;
    address: string | null;
    addressNumber?: string | null;
    district?: string | null;
    city: string | null;
    state: string | null;
    zip: string | null;
    phone: string | null;
    email?: string | null;
    logoUrl?: string | null;
  } | null;
};

function crtLabel(crt: number): string {
  switch (crt) {
    case 1:
      return '1 — Simples Nacional';
    case 2:
      return '2 — Simples Nacional, excesso de sublimite';
    case 3:
      return '3 — Regime normal';
    case 4:
      return '4 — MEI';
    default:
      return String(crt);
  }
}

function freightLabel(mod?: number): string {
  switch (mod) {
    case 0:
      return '0 — Emitente';
    case 1:
      return '1 — Destinatário';
    case 2:
      return '2 — Terceiros';
    default:
      return '9 — Sem frete';
  }
}

function formatKeyGroups(key: string | null | undefined): string {
  const d = String(key ?? '').replace(/\D/g, '');
  if (d.length !== 44) return key ?? '';
  return formatNfceAccessKey(d);
}

function destAddress(c: DanfeNfePayload['document']['sale']['customer']): string {
  if (!c) return '';
  return [c.street, c.number, c.complement, c.district].filter(Boolean).join(', ');
}

function emitAddress(company: NonNullable<DanfeNfePayload['company']>): string {
  return [company.address, company.addressNumber, company.district].filter(Boolean).join(', ');
}

export function DanfeNfeDocument({ data }: { data: DanfeNfePayload }) {
  const doc = data.document;
  const company = data.company;
  const sale = doc.sale;
  const dest = sale.customer;
  const rtc = data.rtc ?? {
    crt: 1,
    totals: { cbs: '0.00', ibsUf: '0.00', ibsMun: '0.00', is: '0.00' },
  };
  const simplesRtc = rtc.crt === 1 || rtc.crt === 2 || rtc.crt === 4;
  const homolog = doc.sefazEnvironment !== 'PRODUCAO';
  const nNF = data.nfe?.nNF;
  const serie = data.nfe?.serie;
  const nature = sale.operationNature;
  const items = sale.items ?? [];
  const payments = sale.payments ?? [];
  const disc = Number(sale.discount) || 0;
  const freight = Number(sale.freightAmount) || 0;
  const surcharge = Number(sale.surcharge) || 0;
  const total = Number(sale.total) || 0;
  const products = Math.max(0, total - freight + disc - surcharge);

  return (
    <article className="danfe-nfe">
      <table className="danfe-nfe-canhoto">
        <tbody>
          <tr>
            <td style={{ width: '72%' }}>
              <span className="lbl">Recebemos de {company?.legalName || company?.tradeName || 'emitente'} os produtos e/ou serviços constantes da Nota Fiscal Eletrônica indicada ao lado</span>
              <div style={{ display: 'flex', gap: '8px', marginTop: '10px' }}>
                <div style={{ flex: '0 0 28%' }}>
                  <span className="lbl">Data de recebimento</span>
                  <div style={{ height: '14px' }} />
                </div>
                <div style={{ flex: 1 }}>
                  <span className="lbl">Identificação e assinatura do recebedor</span>
                  <div style={{ height: '14px' }} />
                </div>
              </div>
            </td>
            <td className="center" style={{ width: '28%' }}>
              <div className="val">NF-e</div>
              <div>Nº {nNF != null ? String(nNF).padStart(9, '0') : '—'}</div>
              <div>Série {serie != null ? String(serie) : '—'}</div>
            </td>
          </tr>
        </tbody>
      </table>
      <hr className="danfe-nfe-cut" />

      {(homolog || data.preview) && (
        <div className="danfe-nfe-watermark">
          {data.preview
            ? 'PRÉ-VISUALIZAÇÃO — SEM VALOR FISCAL'
            : 'EMITIDA EM AMBIENTE DE HOMOLOGAÇÃO — SEM VALOR FISCAL'}
        </div>
      )}

      <table>
        <tbody>
          <tr>
            <td style={{ width: '42%' }} className="center">
              <CompanyLogo
                className="danfe-nfe-logo"
                company={
                  company
                    ? {
                        logoUrl: company.logoUrl,
                        tradeName: company.tradeName,
                        legalName: company.legalName,
                      }
                    : null
                }
              />
              <div className="danfe-nfe-emit">
                <strong>{company?.tradeName || company?.legalName || 'Emitente'}</strong>
                <div>{company?.legalName}</div>
                <div>{company ? emitAddress(company) : ''}</div>
                <div>
                  {[company?.city, company?.state, company?.zip].filter(Boolean).join(' · ')}
                </div>
                <div>
                  CNPJ {company ? formatCnpj(company.cnpj) : '—'}
                  {company?.ie ? ` · IE ${company.ie}` : ''}
                  {company?.im ? ` · IM ${company.im}` : ''}
                </div>
                {company?.phone ? <div>Fone {company.phone}</div> : null}
              </div>
            </td>
            <td className="center" style={{ width: '20%' }}>
              <div className="danfe-nfe-box-title">DANFE</div>
              <div className="tiny">Documento Auxiliar da Nota Fiscal Eletrônica</div>
              <div className="tiny" style={{ marginTop: '4px' }}>
                0 — Entrada
                <br />
                <strong>1 — Saída</strong>
              </div>
              <div style={{ marginTop: '6px' }}>
                <div className="val">Nº {nNF != null ? String(nNF).padStart(9, '0') : '—'}</div>
                <div>Série {serie != null ? String(serie) : '—'}</div>
                <div>Folha 1/1</div>
              </div>
            </td>
            <td style={{ width: '38%' }} className="center">
              {doc.accessKey ? (
                <Code128Barcode value={doc.accessKey} className="danfe-nfe-barcode" height={38} />
              ) : (
                <div className="tiny">Chave ainda não gerada</div>
              )}
              <span className="lbl">Chave de acesso</span>
              <div className="danfe-nfe-key">{formatKeyGroups(doc.accessKey) || '—'}</div>
              <div className="tiny" style={{ marginTop: '4px' }}>
                Consulta de autenticidade no portal nacional da NF-e
                <br />
                www.nfe.fazenda.gov.br/portal
              </div>
            </td>
          </tr>
        </tbody>
      </table>

      <table>
        <tbody>
          <tr>
            <td>
              <span className="lbl">Natureza da operação</span>
              <span className="val">
                {nature ? `${nature.description} (${nature.code})` : 'Venda'}
              </span>
            </td>
            <td style={{ width: '36%' }}>
              <span className="lbl">Protocolo de autorização</span>
              <span className="val">{doc.protocol ?? '—'}</span>
            </td>
          </tr>
          <tr>
            <td>
              <span className="lbl">Inscrição Estadual</span>
              <span className="val">{company?.ie ?? '—'}</span>
            </td>
            <td>
              <span className="lbl">CRT</span>
              <span className="val">{crtLabel(rtc.crt)}</span>
            </td>
          </tr>
        </tbody>
      </table>

      <table>
        <tbody>
          <tr>
            <td colSpan={3}>
              <span className="lbl">Destinatário / remetente</span>
              <span className="val">{dest?.name ?? 'Consumidor não identificado'}</span>
            </td>
            <td style={{ width: '22%' }}>
              <span className="lbl">CNPJ / CPF</span>
              <span className="val">{dest?.document ? formatCpfCnpj(dest.document) : '—'}</span>
            </td>
            <td style={{ width: '18%' }}>
              <span className="lbl">Data da emissão</span>
              <span className="val">{formatDate(sale.createdAt)}</span>
            </td>
          </tr>
          <tr>
            <td colSpan={3}>
              <span className="lbl">Endereço</span>
              <span className="val">{destAddress(dest) || '—'}</span>
            </td>
            <td>
              <span className="lbl">Bairro / distrito</span>
              <span className="val">{dest?.district ?? '—'}</span>
            </td>
            <td>
              <span className="lbl">CEP</span>
              <span className="val">{dest?.zip ?? '—'}</span>
            </td>
          </tr>
          <tr>
            <td>
              <span className="lbl">Município</span>
              <span className="val">{dest?.city ?? '—'}</span>
            </td>
            <td style={{ width: '10%' }}>
              <span className="lbl">UF</span>
              <span className="val">{dest?.state ?? '—'}</span>
            </td>
            <td>
              <span className="lbl">Fone / e-mail</span>
              <span className="val">{[dest?.phone, dest?.email].filter(Boolean).join(' · ') || '—'}</span>
            </td>
            <td colSpan={2}>
              <span className="lbl">Controle interno</span>
              <span className="val">Venda #{sale.number}</span>
            </td>
          </tr>
        </tbody>
      </table>

      <table>
        <tbody>
          <tr>
            <td>
              <span className="lbl">Transportador / volumes</span>
              <span className="val">
                {[
                  freightLabel(sale.freightMod),
                  sale.deliveryVehiclePlate ? `Placa ${sale.deliveryVehiclePlate}` : null,
                  sale.deliveryDriverName ? `Motorista ${sale.deliveryDriverName}` : null,
                ]
                  .filter(Boolean)
                  .join(' · ')}
              </span>
            </td>
          </tr>
        </tbody>
      </table>

      <table className="danfe-nfe-items">
        <thead>
          <tr>
            <th style={{ width: '8%' }}>Cód.</th>
            <th>Descrição do produto / serviço</th>
            <th style={{ width: '8%' }}>NCM</th>
            <th style={{ width: '6%' }}>CST</th>
            <th style={{ width: '6%' }}>CFOP</th>
            <th style={{ width: '5%' }}>Un</th>
            <th style={{ width: '7%' }}>Qtde</th>
            <th style={{ width: '8%' }}>V. unit.</th>
            <th style={{ width: '8%' }}>V. total</th>
          </tr>
        </thead>
        <tbody>
          {items.length === 0 ? (
            <tr>
              <td colSpan={9} className="center">
                Sem itens
              </td>
            </tr>
          ) : (
            items.map((it, i) => {
              const p = it.variant?.product;
              const fs = p?.fiscalSituation;
              const cst = (fs?.csosn || fs?.cstIcms || '').trim() || '—';
              const cfop = (nature?.cfop || fs?.cfopInternal || '').trim() || '—';
              return (
                <tr key={i}>
                  <td>{it.variant?.sku ?? i + 1}</td>
                  <td style={{ textAlign: 'left' }}>{p?.name ?? '—'}</td>
                  <td>{(p?.ncm ?? '').replace(/\D/g, '') || '—'}</td>
                  <td>{cst}</td>
                  <td>{cfop}</td>
                  <td>{p?.taxUnit || 'UN'}</td>
                  <td className="right">{Number(it.quantity).toLocaleString('pt-BR')}</td>
                  <td className="right">{formatBRL(it.unitPrice)}</td>
                  <td className="right">{formatBRL(it.totalLine)}</td>
                </tr>
              );
            })
          )}
        </tbody>
      </table>

      <table>
        <tbody>
          <tr>
            <td>
              <span className="lbl">Base de cálculo do ICMS</span>
              <span className="val right">{formatBRL(0)}</span>
            </td>
            <td>
              <span className="lbl">Valor do ICMS</span>
              <span className="val right">{formatBRL(0)}</span>
            </td>
            <td>
              <span className="lbl">Valor do frete</span>
              <span className="val right">{formatBRL(freight)}</span>
            </td>
            <td>
              <span className="lbl">Desconto</span>
              <span className="val right">{formatBRL(disc)}</span>
            </td>
            <td>
              <span className="lbl">Outras despesas</span>
              <span className="val right">{formatBRL(surcharge)}</span>
            </td>
            <td>
              <span className="lbl">Valor total dos produtos</span>
              <span className="val right">{formatBRL(products)}</span>
            </td>
            <td>
              <span className="lbl">Valor total da nota</span>
              <span className="val right">{formatBRL(total)}</span>
            </td>
          </tr>
        </tbody>
      </table>

      <table>
        <tbody>
          <tr>
            <td>
              <span className="lbl">CBS</span>
              <span className="val">{formatBRL(rtc.totals.cbs)}</span>
            </td>
            <td>
              <span className="lbl">IBS UF</span>
              <span className="val">{formatBRL(rtc.totals.ibsUf)}</span>
            </td>
            <td>
              <span className="lbl">IBS município</span>
              <span className="val">{formatBRL(rtc.totals.ibsMun)}</span>
            </td>
            <td>
              <span className="lbl">Imposto seletivo</span>
              <span className="val">{formatBRL(rtc.totals.is)}</span>
            </td>
          </tr>
        </tbody>
      </table>

      {payments.length > 0 ? (
        <table>
          <tbody>
            <tr>
              {payments.map((p, i) => (
                <td key={i}>
                  <span className="lbl">Forma de pagamento</span>
                  <span className="val">{fiscalPaymentLabel(p)}</span>
                  <span className="val right">{formatBRL(p.amount)}</span>
                </td>
              ))}
            </tr>
          </tbody>
        </table>
      ) : null}

      <table>
        <tbody>
          <tr>
            <td>
              <span className="lbl">Dados adicionais</span>
              <div>
                {sale.notes?.trim() || 'Documento auxiliar da NF-e. A validade jurídica é do XML autorizado pela SEFAZ.'}
              </div>
              {simplesRtc && (
                <div className="tiny" style={{ marginTop: '3px' }}>
                  Em 2026 os totais de IBS/CBS do Simples Nacional e do MEI não são transmitidos no XML
                  (art. 348 da LC 214/2025).
                </div>
              )}
              {doc.lastError && doc.status !== 'AUTHORIZED' ? (
                <div className="tiny" style={{ marginTop: '3px', color: '#b91c1c' }}>
                  {doc.lastError}
                </div>
              ) : null}
            </td>
          </tr>
        </tbody>
      </table>

      <p className="danfe-nfe-foot">
        DANFE — Documento Auxiliar da Nota Fiscal Eletrônica. Este documento não substitui o XML
        autorizado. Controle interno #{sale.number}.
      </p>
    </article>
  );
}
