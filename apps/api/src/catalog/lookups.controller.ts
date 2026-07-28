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
        headers: { Accept: 'application/json' },
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

  /** BrasilAPI — dados cadastrais públicos do CNPJ. */
  @Get('cnpj/:cnpj')
  @Roles('admin', 'manager', 'seller', 'finance')
  async cnpj(@Param('cnpj') cnpjParam: string) {
    const checked = validateCnpj14(cnpjParam);
    if (!checked.ok) throw new BadRequestException(checked.reason);
    const cnpj = checked.cnpj;

    let res: Response;
    try {
      res = await fetch(`https://brasilapi.com.br/api/cnpj/v1/${cnpj}`, {
        headers: { Accept: 'application/json' },
      });
    } catch {
      throw new BadRequestException('Não foi possível consultar o CNPJ (BrasilAPI).');
    }
    if (res.status === 404) {
      throw new BadRequestException('CNPJ não encontrado na BrasilAPI.');
    }
    if (!res.ok) {
      throw new BadRequestException(`BrasilAPI retornou HTTP ${res.status}.`);
    }
    const data = (await res.json()) as BrasilApiCnpj;
    const streetParts = [
      data.descricao_tipo_de_logradouro,
      data.logradouro,
    ]
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
    };
  }
}
