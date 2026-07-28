import {
  BadRequestException,
  Controller,
  Get,
  Param,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { digitsCnpj, validateCnpj14 } from '../common/cnpj.util';

/** Cloudflare da BrasilAPI bloqueia fetch sem User-Agent (HTTP 403). */
const LOOKUP_UA = 'GestorVend/1.0 (+https://github.com/jrbsnunes-glitch/gestorvend)';

type ViaCepResponse = {
  erro?: boolean;
  cep?: string;
  logradouro?: string;
  complemento?: string;
  bairro?: string;
  localidade?: string;
  uf?: string;
  ibge?: string;
};

type BrasilApiCnpj = {
  cnpj?: string;
  razao_social?: string;
  nome_fantasia?: string;
  email?: string;
  ddd_telefone_1?: string;
  descricao_tipo_de_logradouro?: string;
  logradouro?: string;
  numero?: string;
  complemento?: string;
  bairro?: string;
  cep?: string;
  municipio?: string;
  uf?: string;
};

/** ReceitaWS — fallback gratuito se BrasilAPI falhar. */
type ReceitaWsCnpj = {
  status?: string;
  message?: string;
  cnpj?: string;
  nome?: string;
  fantasia?: string;
  email?: string;
  telefone?: string;
  logradouro?: string;
  numero?: string;
  complemento?: string;
  bairro?: string;
  municipio?: string;
  uf?: string;
  cep?: string;
};

type CnpjLookupResult = {
  document: string;
  legalName: string;
  tradeName: string;
  email: string;
  phone: string;
  street: string;
  number: string;
  complement: string;
  district: string;
  city: string;
  state: string;
  zip: string;
  source: 'brasilapi' | 'receitaws';
};

@Controller('lookups')
@UseGuards(JwtAuthGuard, RolesGuard)
export class LookupsController {
  /** ViaCEP — preenchimento de endereço. */
  @Get('cep/:cep')
  @Roles('admin', 'manager', 'seller', 'finance')
  async cep(@Param('cep') cepParam: string) {
    const cep = String(cepParam ?? '').replace(/\D/g, '');
    if (cep.length !== 8) {
      throw new BadRequestException('CEP deve ter 8 dígitos.');
    }
    let res: Response;
    try {
      res = await fetch(`https://viacep.com.br/ws/${cep}/json/`, {
        headers: { Accept: 'application/json', 'User-Agent': LOOKUP_UA },
      });
    } catch {
      throw new BadRequestException('Não foi possível consultar o CEP (ViaCEP).');
    }
    if (!res.ok) {
      throw new BadRequestException(`ViaCEP retornou HTTP ${res.status}.`);
    }
    const data = (await res.json()) as ViaCepResponse;
    if (data.erro) {
      throw new BadRequestException('CEP não encontrado.');
    }
    return {
      zip: (data.cep ?? cep).replace(/\D/g, ''),
      street: data.logradouro ?? '',
      complement: data.complemento ?? '',
      district: data.bairro ?? '',
      city: data.localidade ?? '',
      state: data.uf ?? '',
      ibge: data.ibge ?? null,
    };
  }

  /**
   * Consulta pública de CNPJ.
   * Preferência: BrasilAPI; fallback: ReceitaWS (ambos gratuitos).
   */
  @Get('cnpj/:cnpj')
  @Roles('admin', 'manager', 'seller', 'finance')
  async cnpj(@Param('cnpj') cnpjParam: string): Promise<CnpjLookupResult> {
    const checked = validateCnpj14(cnpjParam);
    if (!checked.ok) throw new BadRequestException(checked.reason);
    const cnpj = checked.cnpj;

    const fromBrasil = await this.fetchBrasilApiCnpj(cnpj);
    if (fromBrasil) return fromBrasil;

    const fromReceita = await this.fetchReceitaWsCnpj(cnpj);
    if (fromReceita) return fromReceita;

    throw new BadRequestException(
      'Não foi possível consultar o CNPJ (BrasilAPI e ReceitaWS indisponíveis). Tente novamente em instantes.',
    );
  }

  private async fetchBrasilApiCnpj(cnpj: string): Promise<CnpjLookupResult | null> {
    let res: Response;
    try {
      res = await fetch(`https://brasilapi.com.br/api/cnpj/v1/${cnpj}`, {
        headers: {
          Accept: 'application/json',
          'User-Agent': LOOKUP_UA,
        },
      });
    } catch {
      return null;
    }
    if (res.status === 404) {
      throw new BadRequestException('CNPJ não encontrado.');
    }
    if (!res.ok) return null;

    const data = (await res.json()) as BrasilApiCnpj;
    const streetParts = [data.descricao_tipo_de_logradouro, data.logradouro]
      .filter(Boolean)
      .join(' ')
      .trim();
    const phone = data.ddd_telefone_1
      ? String(data.ddd_telefone_1).replace(/\D/g, '')
      : '';

    return {
      document: digitsCnpj(data.cnpj ?? cnpj),
      legalName: data.razao_social ?? '',
      tradeName: data.nome_fantasia || data.razao_social || '',
      email: data.email ?? '',
      phone,
      street: streetParts,
      number: data.numero ?? '',
      complement: data.complemento ?? '',
      district: data.bairro ?? '',
      city: data.municipio ?? '',
      state: data.uf ?? '',
      zip: String(data.cep ?? '').replace(/\D/g, ''),
      source: 'brasilapi',
    };
  }

  private async fetchReceitaWsCnpj(cnpj: string): Promise<CnpjLookupResult | null> {
    let res: Response;
    try {
      res = await fetch(`https://www.receitaws.com.br/v1/cnpj/${cnpj}`, {
        headers: {
          Accept: 'application/json',
          'User-Agent': LOOKUP_UA,
        },
      });
    } catch {
      return null;
    }
    if (res.status === 404) {
      throw new BadRequestException('CNPJ não encontrado.');
    }
    if (!res.ok) return null;

    const data = (await res.json()) as ReceitaWsCnpj;
    if (String(data.status ?? '').toUpperCase() === 'ERROR') {
      throw new BadRequestException(data.message || 'CNPJ não encontrado.');
    }

    return {
      document: digitsCnpj(data.cnpj ?? cnpj),
      legalName: data.nome ?? '',
      tradeName: data.fantasia || data.nome || '',
      email: data.email ?? '',
      phone: String(data.telefone ?? '').replace(/\D/g, ''),
      street: data.logradouro ?? '',
      number: data.numero ?? '',
      complement: data.complemento ?? '',
      district: data.bairro ?? '',
      city: data.municipio ?? '',
      state: data.uf ?? '',
      zip: String(data.cep ?? '').replace(/\D/g, ''),
      source: 'receitaws',
    };
  }
}
