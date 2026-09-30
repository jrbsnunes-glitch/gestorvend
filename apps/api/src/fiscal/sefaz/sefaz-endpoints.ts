import { FiscalSefazEnvironment } from '../../generated/tenant-client';

export type FiscalModel = '55' | '65';

export type SefazWebservices = {
  autorizacao: string;
  consulta: string;
  status: string;
  recepcaoEvento: string;
  inutilizacao: string;
  nfceQrConsultaBase?: string;
  nfceUrlChave?: string;
};

/** URLs oficiais SEFAZ/AM — paths case-sensitive (Nfe*, RecepcaoEvento4). */
const AM = {
  nfe: {
    homologacao: {
      autorizacao:
        'https://homnfe.sefaz.am.gov.br/services2/services/NfeAutorizacao4',
      retAutorizacao:
        'https://homnfe.sefaz.am.gov.br/services2/services/NfeRetAutorizacao4',
      consulta: 'https://homnfe.sefaz.am.gov.br/services2/services/NfeConsulta4',
      recepcaoEvento:
        'https://homnfe.sefaz.am.gov.br/services2/services/RecepcaoEvento4',
      inutilizacao:
        'https://homnfe.sefaz.am.gov.br/services2/services/NfeInutilizacao4',
      status: 'https://homnfe.sefaz.am.gov.br/services2/services/NfeStatusServico4',
    },
    producao: {
      autorizacao: 'https://nfe.sefaz.am.gov.br/services2/services/NfeAutorizacao4',
      retAutorizacao: 'https://nfe.sefaz.am.gov.br/services2/services/NfeRetAutorizacao4',
      consulta: 'https://nfe.sefaz.am.gov.br/services2/services/NfeConsulta4',
      recepcaoEvento: 'https://nfe.sefaz.am.gov.br/services2/services/RecepcaoEvento4',
      inutilizacao: 'https://nfe.sefaz.am.gov.br/services2/services/NfeInutilizacao4',
      status: 'https://nfe.sefaz.am.gov.br/services2/services/NfeStatusServico4',
    },
  },
  nfce: {
    homologacao: {
      autorizacao:
        'https://homnfce.sefaz.am.gov.br/nfce-services/services/NfeAutorizacao4',
      retAutorizacao:
        'https://homnfce.sefaz.am.gov.br/nfce-services/services/NfeRetAutorizacao4',
      consulta:
        'https://homnfce.sefaz.am.gov.br/nfce-services/services/NfeConsulta4',
      recepcaoEvento:
        'https://homnfce.sefaz.am.gov.br/nfce-services/services/RecepcaoEvento4',
      inutilizacao:
        'https://homnfce.sefaz.am.gov.br/nfce-services/services/NfeInutilizacao4',
      status:
        'https://homnfce.sefaz.am.gov.br/nfce-services/services/NfeStatusServico4',
    },
    producao: {
      autorizacao: 'https://nfce.sefaz.am.gov.br/nfce-services/services/NfeAutorizacao4',
      retAutorizacao:
        'https://nfce.sefaz.am.gov.br/nfce-services/services/NfeRetAutorizacao4',
      consulta: 'https://nfce.sefaz.am.gov.br/nfce-services/services/NfeConsulta4',
      recepcaoEvento:
        'https://nfce.sefaz.am.gov.br/nfce-services/services/RecepcaoEvento4',
      inutilizacao:
        'https://nfce.sefaz.am.gov.br/nfce-services/services/NfeInutilizacao4',
      status: 'https://nfce.sefaz.am.gov.br/nfce-services/services/NfeStatusServico4',
    },
  },
} as const;

const SVRS_NFCE_AUT_HOM =
  'https://nfce-homologacao.svrs.rs.gov.br/ws/NfeAutorizacao/NFeAutorizacao4.asmx';
const SVRS_NFCE_AUT_PROD = 'https://nfce.svrs.rs.gov.br/ws/NfeAutorizacao/NFeAutorizacao4.asmx';
const SVRS_NFE_AUT_HOM =
  'https://nfe-homologacao.svrs.rs.gov.br/ws/NfeAutorizacao/NFeAutorizacao4.asmx';
const SVRS_NFE_AUT_PROD = 'https://nfe.svrs.rs.gov.br/ws/NfeAutorizacao/NFeAutorizacao4.asmx';

const SVRS_NFCE_CONS_HOM =
  'https://nfce-homologacao.svrs.rs.gov.br/ws/NFeConsultaProtocolo/NFeConsultaProtocolo4.asmx';
const SVRS_NFCE_CONS_PROD =
  'https://nfce.svrs.rs.gov.br/ws/NFeConsultaProtocolo/NFeConsultaProtocolo4.asmx';
const SVRS_NFE_CONS_HOM =
  'https://nfe-homologacao.svrs.rs.gov.br/ws/NFeConsultaProtocolo/NFeConsultaProtocolo4.asmx';
const SVRS_NFE_CONS_PROD =
  'https://nfe.svrs.rs.gov.br/ws/NFeConsultaProtocolo/NFeConsultaProtocolo4.asmx';

const SVRS_INUTIL_HOM =
  'https://nfe-homologacao.svrs.rs.gov.br/ws/nfeinutilizacao/nfeinutilizacao4.asmx';
const SVRS_INUTIL_PROD = 'https://nfe.svrs.rs.gov.br/ws/nfeinutilizacao/nfeinutilizacao4.asmx';

const SVRS_STATUS_HOM =
  'https://nfe-homologacao.svrs.rs.gov.br/ws/NfeStatusServico/NfeStatusServico4.asmx';
const SVRS_STATUS_PROD = 'https://nfe.svrs.rs.gov.br/ws/NfeStatusServico/NfeStatusServico4.asmx';

const AN_NFCE_QR_HOM = 'http://homnfce.sefaz.am.gov.br/nfce/consulta';
const AN_NFCE_QR_PROD = 'http://nfce.sefaz.am.gov.br/nfce/consulta';
const AN_NFCE_URL_CHAVE = 'http://www.sefaz.am.gov.br/nfce/consulta';

const SP_NFCE_QR_HOM =
  'https://www.homologacao.nfce.fazenda.sp.gov.br/NFCeConsultaPublica/Paginas/ConsultaPublica.aspx';
const SP_NFCE_URL_CHAVE = 'http://www.fazenda.sp.gov.br/nfce/consulta';

export type SefazEndpointOverrides = Partial<
  Pick<
    SefazWebservices,
    'autorizacao' | 'consulta' | 'status' | 'recepcaoEvento' | 'inutilizacao'
  >
>;

function amBucket(model: FiscalModel, production: boolean) {
  const env = production ? 'producao' : 'homologacao';
  return model === '65' ? AM.nfce[env] : AM.nfe[env];
}

function svrsBucket(model: FiscalModel, production: boolean): SefazWebservices {
  const isNfce = model === '65';
  return {
    autorizacao: isNfce
      ? production
        ? SVRS_NFCE_AUT_PROD
        : SVRS_NFCE_AUT_HOM
      : production
        ? SVRS_NFE_AUT_PROD
        : SVRS_NFE_AUT_HOM,
    consulta: isNfce
      ? production
        ? SVRS_NFCE_CONS_PROD
        : SVRS_NFCE_CONS_HOM
      : production
        ? SVRS_NFE_CONS_PROD
        : SVRS_NFE_CONS_HOM,
    status: production ? SVRS_STATUS_PROD : SVRS_STATUS_HOM,
    recepcaoEvento: production
      ? 'https://www.nfe.fazenda.gov.br/NFeRecepcaoEvento4/NFeRecepcaoEvento4.asmx'
      : 'https://hom.nfe.fazenda.gov.br/NFeRecepcaoEvento4/NFeRecepcaoEvento4.asmx',
    inutilizacao: production ? SVRS_INUTIL_PROD : SVRS_INUTIL_HOM,
    nfceQrConsultaBase: isNfce ? (production ? undefined : SP_NFCE_QR_HOM) : undefined,
    nfceUrlChave: isNfce ? SP_NFCE_URL_CHAVE : undefined,
  };
}

/** Resolve webservices por UF emissor (AM nativo; demais UF → SVRS / AN para eventos). */
export function resolveSefazWebservices(params: {
  uf: string;
  production: boolean;
  model: FiscalModel;
  overrides?: SefazEndpointOverrides;
}): SefazWebservices {
  const uf = (params.uf ?? 'RS').trim().toUpperCase().slice(0, 2);
  let base: SefazWebservices;
  if (uf === 'AM') {
    const am = amBucket(params.model, params.production);
    base = {
      autorizacao: am.autorizacao,
      consulta: am.consulta,
      status: am.status,
      recepcaoEvento: am.recepcaoEvento,
      inutilizacao: am.inutilizacao,
      nfceQrConsultaBase:
        params.model === '65'
          ? params.production
            ? AN_NFCE_QR_PROD
            : AN_NFCE_QR_HOM
          : undefined,
      nfceUrlChave: params.model === '65' ? AN_NFCE_URL_CHAVE : undefined,
    };
  } else {
    base = svrsBucket(params.model, params.production);
  }

  const o = params.overrides ?? {};
  return {
    autorizacao: o.autorizacao?.trim() || base.autorizacao,
    consulta: o.consulta?.trim() || base.consulta,
    status: o.status?.trim() || base.status,
    recepcaoEvento: o.recepcaoEvento?.trim() || base.recepcaoEvento,
    inutilizacao: o.inutilizacao?.trim() || base.inutilizacao,
    nfceQrConsultaBase: base.nfceQrConsultaBase,
    nfceUrlChave: base.nfceUrlChave,
  };
}

export function sefazEnvironmentIsProduction(env: FiscalSefazEnvironment): boolean {
  return env === FiscalSefazEnvironment.PRODUCAO;
}
