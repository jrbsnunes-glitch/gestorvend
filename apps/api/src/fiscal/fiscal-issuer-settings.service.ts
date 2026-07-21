import { BadRequestException, Injectable } from '@nestjs/common';
import {
  Company,
  FiscalIssuerSettings,
  FiscalSefazEnvironment,
  Prisma,
} from '../generated/tenant-client';
import { TenantPrismaService } from '../prisma/tenant-prisma.service';
import { formatPfxLoadError } from './issuer/pfx.errors';
import { IssuerCertificateStorage } from './issuer/issuer-certificate.storage';
import { loadPfxMaterialFromBuffer } from './issuer/load-pfx';

function onlyDigits7(s: string): string {
  return s.replace(/\D/g, '').slice(0, 7);
}

/** Fallbacks opcionais vindos do `.env` da API (instância única / legado). */
export type FiscalIssuerEnvFallback = {
  certPath?: string;
  certPasswordConfigured: boolean;
  cscId?: string;
  cscSecretConfigured: boolean;
};

/** DTO para o painel — sem expor segredos em texto (só flags + CSC ID da base). */
export type FiscalIssuerPublicDto = {
  sefazEnvironment: FiscalSefazEnvironment;
  crt: number;
  uf: string;
  municipalityIbge: string;
  nfceSerie: number;
  nfeSerie: number;
  nfceLastNumber: number;
  nfeLastNumber: number;
  certificatePath: string | null;
  /** Path aponta para o .pfx gerenciado pelo upload (pasta certs do tenant). */
  certificateManagedUpload: boolean;
  /** `FISCAL_ISSUER_CERT_PATH` preenchido e sem `certificatePath` na base. */
  certPathFromEnvFallback: boolean;
  /** Senha do .pfx guardada na base deste tenant. */
  hasCertificatePasswordInDb: boolean;
  /** Senha efetiva (base ou `FISCAL_ISSUER_CERT_PASSWORD`). */
  certificatePasswordConfigured: boolean;
  /** ID CSC guardado na base (edição no painel). */
  nfceCscId: string | null;
  /** Segredo CSC guardado na base (não devolve o valor). */
  hasNfceCscSecretInDb: boolean;
  /** Segredo efetivo (base ou `FISCAL_NFCE_CSC`). */
  nfceCscSecretConfigured: boolean;
  /** ID CSC efetivo (base ou `FISCAL_NFCE_CSC_ID`). */
  nfceCscIdConfigured: boolean;
  /** ID vem só do `.env` (base vazia). */
  nfceCscIdFromEnvFallback: boolean;
  /** Segredo vem só do `.env` (base vazia). */
  nfceCscSecretFromEnvFallback: boolean;
  /** Entrada automática a partir da caixa NF-e. */
  inboundAutoReceiptEnabled: boolean;
  inboundAutoReceiptPostStock: boolean;
  inboundAutoReceiptMinMatchPercent: number;
  inboundUltNsu: string | null;
};

@Injectable()
export class FiscalIssuerSettingsService {
  constructor(
    private readonly tenantPrisma: TenantPrismaService,
    private readonly certStorage: IssuerCertificateStorage,
  ) {}

  /** Garante linha singleton de emissor; retorna null se ainda não houver empresa. */
  async ensureForTenant(
    tenantSlug: string,
  ): Promise<{ company: Company; settings: FiscalIssuerSettings } | null> {
    const db = await this.tenantPrisma.getClient(tenantSlug);
    const company = await db.company.findFirst({ orderBy: { createdAt: 'asc' } });
    if (!company) return null;

    const existing = await db.fiscalIssuerSettings.findUnique({
      where: { companyId: company.id },
    });
    if (existing) return { company, settings: existing };

    const uf = (company.state ?? 'SP').trim().toUpperCase().slice(0, 2) || 'SP';
    const settings = await db.fiscalIssuerSettings.create({
      data: {
        companyId: company.id,
        uf,
        municipalityIbge: '3550308',
        crt: 1,
        sefazEnvironment: FiscalSefazEnvironment.HOMOLOGACAO,
      },
    });
    return { company, settings };
  }

  async getPublic(tenantSlug: string, env: FiscalIssuerEnvFallback): Promise<FiscalIssuerPublicDto> {
    const row = await this.ensureForTenant(tenantSlug);
    if (!row) {
      throw new BadRequestException('Cadastre a empresa (menu Empresa) antes do emissor fiscal.');
    }
    return this.toPublic(tenantSlug, row.settings, env);
  }

  toPublic(
    tenantSlug: string,
    s: FiscalIssuerSettings,
    env: FiscalIssuerEnvFallback,
  ): FiscalIssuerPublicDto {
    const dbPath = s.certificatePath?.trim() ?? '';
    const envPath = env.certPath?.trim() ?? '';
    const hasDbCertPwd = Boolean(s.certificatePassword?.trim());
    const certPwdEffective = hasDbCertPwd || env.certPasswordConfigured;

    const dbCscId = s.nfceCscId?.trim() ?? '';
    const envCscId = env.cscId?.trim() ?? '';
    const hasDbCscSecret = Boolean(s.nfceCsc?.trim());
    const cscSecretEffective = hasDbCscSecret || env.cscSecretConfigured;
    const cscIdEffective = Boolean(dbCscId || envCscId);

    return {
      sefazEnvironment: s.sefazEnvironment,
      crt: s.crt,
      uf: s.uf,
      municipalityIbge: s.municipalityIbge,
      nfceSerie: s.nfceSerie,
      nfeSerie: s.nfeSerie,
      nfceLastNumber: s.nfceLastNumber,
      nfeLastNumber: s.nfeLastNumber,
      certificatePath: s.certificatePath ?? null,
      certificateManagedUpload: this.certStorage.isManagedPath(tenantSlug, s.certificatePath),
      certPathFromEnvFallback: Boolean(envPath) && !dbPath,
      hasCertificatePasswordInDb: hasDbCertPwd,
      certificatePasswordConfigured: certPwdEffective,
      nfceCscId: dbCscId || null,
      hasNfceCscSecretInDb: hasDbCscSecret,
      nfceCscSecretConfigured: cscSecretEffective,
      nfceCscIdConfigured: cscIdEffective,
      nfceCscIdFromEnvFallback: Boolean(envCscId) && !dbCscId,
      nfceCscSecretFromEnvFallback: env.cscSecretConfigured && !hasDbCscSecret,
      inboundAutoReceiptEnabled: s.inboundAutoReceiptEnabled,
      inboundAutoReceiptPostStock: s.inboundAutoReceiptPostStock,
      inboundAutoReceiptMinMatchPercent: s.inboundAutoReceiptMinMatchPercent,
      inboundUltNsu: s.inboundUltNsu,
    };
  }

  async uploadCertificate(
    tenantSlug: string,
    file: { buffer: Buffer; originalname?: string; mimetype?: string; size?: number } | undefined,
    passwordFromForm: string | undefined,
    env: FiscalIssuerEnvFallback,
  ): Promise<FiscalIssuerPublicDto> {
    const db = await this.tenantPrisma.getClient(tenantSlug);
    const row = await this.ensureForTenant(tenantSlug);
    if (!row) {
      throw new BadRequestException('Cadastre a empresa (menu Empresa) antes do emissor fiscal.');
    }

    const buffer = this.certStorage.assertPfxUpload(
      file ?? { buffer: Buffer.alloc(0) },
    );

    const pwdForm = passwordFromForm?.trim() ?? '';
    const pwdDb = row.settings.certificatePassword?.trim() ?? '';
    const password = pwdForm || pwdDb;
    if (!password) {
      throw new BadRequestException(
        'Informe a senha do .pfx no campo abaixo (ou salve a senha antes) para validar o certificado no envio.',
      );
    }

    try {
      loadPfxMaterialFromBuffer(buffer, password);
    } catch (e) {
      throw new BadRequestException(
        formatPfxLoadError(e, file?.originalname?.trim() || 'certificado.pfx'),
      );
    }

    const absolutePath = await this.certStorage.save(tenantSlug, buffer);
    const data: Prisma.FiscalIssuerSettingsUpdateInput = {
      certificatePath: absolutePath,
    };
    if (pwdForm) {
      if (pwdForm.length > 500) {
        throw new BadRequestException('Senha do certificado longa demais.');
      }
      data.certificatePassword = pwdForm;
    }

    const updated = await db.fiscalIssuerSettings.update({
      where: { id: row.settings.id },
      data,
    });
    return this.toPublic(tenantSlug, updated, env);
  }

  async patch(
    tenantSlug: string,
    body: Record<string, unknown>,
    env: FiscalIssuerEnvFallback,
  ): Promise<FiscalIssuerPublicDto> {
    const db = await this.tenantPrisma.getClient(tenantSlug);
    const row = await this.ensureForTenant(tenantSlug);
    if (!row) {
      throw new BadRequestException('Cadastre a empresa (menu Empresa) antes do emissor fiscal.');
    }
    const { settings } = row;
    const data: Prisma.FiscalIssuerSettingsUpdateInput = {};

    if (body.sefazEnvironment !== undefined) {
      const v = String(body.sefazEnvironment);
      if (v !== 'HOMOLOGACAO' && v !== 'PRODUCAO') {
        throw new BadRequestException('Ambiente SEFAZ inválido.');
      }
      data.sefazEnvironment = v as FiscalSefazEnvironment;
    }
    if (body.crt !== undefined) {
      const n = Number(body.crt);
      if (![1, 2, 3].includes(n)) {
        throw new BadRequestException('CRT deve ser 1 (SN), 2 (SN excesso) ou 3 (normal).');
      }
      data.crt = n;
    }
    if (body.uf !== undefined) {
      const uf = String(body.uf ?? '')
        .trim()
        .toUpperCase()
        .slice(0, 2);
      if (uf.length !== 2) throw new BadRequestException('UF deve ter 2 letras.');
      data.uf = uf;
    }
    if (body.municipalityIbge !== undefined) {
      const mun = onlyDigits7(String(body.municipalityIbge));
      if (mun.length !== 7 || mun === '0000000') {
        throw new BadRequestException(
          'Informe o código IBGE do município (7 dígitos, sem zeros inválidos).',
        );
      }
      data.municipalityIbge = mun;
    }
    if (body.nfceSerie !== undefined) {
      const n = Number(body.nfceSerie);
      if (!Number.isFinite(n) || n < 1 || n > 999) {
        throw new BadRequestException('Série NFC-e inválida (1–999).');
      }
      data.nfceSerie = Math.trunc(n);
    }
    if (body.nfeSerie !== undefined) {
      const n = Number(body.nfeSerie);
      if (!Number.isFinite(n) || n < 1 || n > 999) {
        throw new BadRequestException('Série NF-e inválida (1–999).');
      }
      data.nfeSerie = Math.trunc(n);
    }
    if (body.certificatePath !== undefined) {
      const p = body.certificatePath === null ? null : String(body.certificatePath).trim();
      if (p && p.length > 500) throw new BadRequestException('Caminho ao certificado longo demais.');
      data.certificatePath = p;
    }

    if (body.nfceCscId !== undefined) {
      if (body.nfceCscId === null || body.nfceCscId === '') {
        data.nfceCscId = null;
      } else {
        const id = String(body.nfceCscId).trim();
        if (id.length > 60) throw new BadRequestException('CSC ID longo demais.');
        data.nfceCscId = id;
      }
    }

    if (body.clearNfceCsc === true) {
      data.nfceCsc = null;
    } else if (Object.prototype.hasOwnProperty.call(body, 'nfceCsc')) {
      const raw = body.nfceCsc;
      if (raw !== null && raw !== undefined && String(raw).trim() !== '') {
        const token = String(raw).trim();
        if (token.length > 500) throw new BadRequestException('Token CSC longo demais.');
        data.nfceCsc = token;
      }
    }

    if (body.clearCertificatePassword === true) {
      data.certificatePassword = null;
    } else if (Object.prototype.hasOwnProperty.call(body, 'certificatePassword')) {
      const raw = body.certificatePassword;
      if (raw !== null && raw !== undefined && String(raw).trim() !== '') {
        const pwd = String(raw).trim();
        if (pwd.length > 500) throw new BadRequestException('Senha do certificado longa demais.');
        data.certificatePassword = pwd;
      }
    }

    if (body.inboundAutoReceiptEnabled !== undefined) {
      data.inboundAutoReceiptEnabled = Boolean(body.inboundAutoReceiptEnabled);
    }
    if (body.inboundAutoReceiptPostStock !== undefined) {
      data.inboundAutoReceiptPostStock = Boolean(body.inboundAutoReceiptPostStock);
    }
    if (body.inboundAutoReceiptMinMatchPercent !== undefined) {
      const n = Number(body.inboundAutoReceiptMinMatchPercent);
      if (!Number.isFinite(n) || n < 0 || n > 100) {
        throw new BadRequestException('Percentual mínimo de match deve ser entre 0 e 100.');
      }
      data.inboundAutoReceiptMinMatchPercent = Math.trunc(n);
    }

    const updated = await db.fiscalIssuerSettings.update({
      where: { id: settings.id },
      data,
    });
    return this.toPublic(tenantSlug, updated, env);
  }
}
