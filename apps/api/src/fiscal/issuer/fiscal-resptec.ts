import { ConfigService } from '@nestjs/config';

export type SoftwareHouseRespTec = {
  cnpj: string;
  xContato: string;
  email: string;
  fone: string;
};

function env(config: ConfigService, ...keys: string[]): string {
  for (const key of keys) {
    const raw = config.get<string>(key)?.trim();
    if (raw) return raw;
  }
  return '';
}

/**
 * infRespTec (NT 2018.005) identifica a software house, nunca o emitente.
 * Fonte: variáveis de ambiente do servidor (válidas para todos os tenants).
 */
export function resolveSoftwareHouseRespTec(
  config: ConfigService,
): SoftwareHouseRespTec | null {
  const cnpj = env(config, 'FISCAL_RESPTEC_CNPJ', 'FISCAL_RESP_TEC_CNPJ').replace(/\D/g, '');
  const xContato = env(config, 'FISCAL_RESPTEC_CONTATO', 'FISCAL_RESP_TEC_CONTACT');
  const email = env(config, 'FISCAL_RESPTEC_EMAIL', 'FISCAL_RESP_TEC_EMAIL');
  const fone = env(config, 'FISCAL_RESPTEC_FONE', 'FISCAL_RESP_TEC_PHONE').replace(/\D/g, '');
  if (cnpj.length !== 14 || !xContato || !email.includes('@') || fone.length < 6) {
    return null;
  }
  return { cnpj, xContato, email, fone };
}
