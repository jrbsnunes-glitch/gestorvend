import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { randomBytes, randomUUID } from 'crypto';
import {
  CashSessionStatus,
  PdvTerminalMode,
  Prisma,
  SaleSource,
  SaleStatus,
} from '../generated/tenant-client';
import { TenantPrismaService } from '../prisma/tenant-prisma.service';
import { SalesService } from '../sales/sales.service';
import { PaymentCredentialsService } from '../payments/payment-credentials.service';
import { CompanyService } from '../company/company.service';
import { PaymentMethod } from '../generated/tenant-client';

const BCRYPT_ROUNDS = 10;

export type PdvTerminalPublic = {
  id: string;
  number: number;
  name: string;
  mode: PdvTerminalMode;
  isActive: boolean;
  allowedMethods: string[];
  operatorUserId: string | null;
  mpPointTerminalId: string | null;
  lastSeenAt: string | null;
  createdAt: string;
  pairingUrl: string;
};

export type KioskBootstrap = {
  terminal: PdvTerminalPublic;
  cashSessionId: string | null;
  payments: {
    mercadoPagoEnabled: boolean;
    hasOnlinePix: boolean;
    hasPointIntegration: boolean;
    mercadoPagoPublicKey: string | null;
    activeProvider: string | null;
    visibleProviders: string[];
  };
};

@Injectable()
export class PdvTerminalsService {
  constructor(
    private readonly tenantPrisma: TenantPrismaService,
    private readonly sales: SalesService,
    private readonly paymentCredentials: PaymentCredentialsService,
    private readonly company: CompanyService,
  ) {}

  parseAllowedMethods(raw: unknown): string[] {
    if (!Array.isArray(raw)) return ['PIX', 'CARD_CREDIT', 'CARD_DEBIT'];
    return raw.filter((x): x is string => typeof x === 'string' && x.trim().length > 0);
  }

  private toPublic(row: {
    id: string;
    number: number;
    name: string;
    mode: PdvTerminalMode;
    isActive: boolean;
    allowedMethods: unknown;
    operatorUserId: string | null;
    mpPointTerminalId?: string | null;
    lastSeenAt: Date | null;
    createdAt: Date;
  }): PdvTerminalPublic {
    return {
      id: row.id,
      number: row.number,
      name: row.name,
      mode: row.mode,
      isActive: row.isActive,
      allowedMethods: this.parseAllowedMethods(row.allowedMethods),
      operatorUserId: row.operatorUserId,
      mpPointTerminalId: row.mpPointTerminalId ?? null,
      lastSeenAt: row.lastSeenAt?.toISOString() ?? null,
      createdAt: row.createdAt.toISOString(),
      pairingUrl: `/auto-atendimento?terminal=${row.number}`,
    };
  }

  async list(tenantSlug: string) {
    const db = await this.tenantPrisma.getClient(tenantSlug);
    const rows = await db.pdvTerminal.findMany({ orderBy: { number: 'asc' } });
    return rows.map((r) => this.toPublic(r));
  }

  async create(
    tenantSlug: string,
    body: {
      number?: number;
      name: string;
      mode?: PdvTerminalMode;
      allowedMethods?: string[];
      operatorUserId?: string | null;
    },
  ) {
    const name = (body.name ?? '').trim();
    if (!name) throw new BadRequestException('Informe o nome do PDV.');
    const db = await this.tenantPrisma.getClient(tenantSlug);

    let number = body.number;
    if (number == null || !Number.isFinite(number) || number < 1) {
      const max = await db.pdvTerminal.aggregate({ _max: { number: true } });
      number = (max._max.number ?? 0) + 1;
    } else {
      number = Math.floor(number);
      const exists = await db.pdvTerminal.findUnique({ where: { number } });
      if (exists) throw new BadRequestException(`Já existe PDV número ${number}.`);
    }

    const id = randomUUID();
    const secret = randomBytes(24).toString('base64url');
    const secretHash = await bcrypt.hash(secret, BCRYPT_ROUNDS);
    const allowedMethods = body.allowedMethods?.length
      ? body.allowedMethods
      : ['PIX', 'CARD_CREDIT', 'CARD_DEBIT'];

    const row = await db.pdvTerminal.create({
      data: {
        id,
        number,
        name,
        mode: body.mode ?? PdvTerminalMode.SELF_SERVICE,
        secretHash,
        allowedMethods: allowedMethods as Prisma.InputJsonValue,
        operatorUserId: body.operatorUserId?.trim() || null,
      },
    });

    return {
      ...this.toPublic(row),
      token: `${row.id}.${secret}`,
    };
  }

  async update(
    tenantSlug: string,
    id: string,
    body: {
      name?: string;
      mode?: PdvTerminalMode;
      isActive?: boolean;
      allowedMethods?: string[];
      operatorUserId?: string | null;
      mpPointTerminalId?: string | null;
    },
  ) {
    const db = await this.tenantPrisma.getClient(tenantSlug);
    const current = await db.pdvTerminal.findUnique({ where: { id } });
    if (!current) throw new NotFoundException('PDV não encontrado.');

    const data: Prisma.PdvTerminalUpdateInput = {};
    if (body.name !== undefined) {
      const n = body.name.trim();
      if (!n) throw new BadRequestException('Nome inválido.');
      data.name = n;
    }
    if (body.mode !== undefined) data.mode = body.mode;
    if (body.isActive !== undefined) data.isActive = body.isActive;
    if (body.allowedMethods !== undefined) {
      data.allowedMethods = body.allowedMethods as Prisma.InputJsonValue;
    }
    if (body.operatorUserId !== undefined) {
      data.operatorUser = body.operatorUserId
        ? { connect: { id: body.operatorUserId } }
        : { disconnect: true };
    }
    if (body.mpPointTerminalId !== undefined) {
      const v = body.mpPointTerminalId?.trim();
      data.mpPointTerminalId = v || null;
    }

    const row = await db.pdvTerminal.update({ where: { id }, data });
    return this.toPublic(row);
  }

  async rotateToken(tenantSlug: string, id: string) {
    const db = await this.tenantPrisma.getClient(tenantSlug);
    const current = await db.pdvTerminal.findUnique({ where: { id } });
    if (!current) throw new NotFoundException('PDV não encontrado.');
    const secret = randomBytes(24).toString('base64url');
    const secretHash = await bcrypt.hash(secret, BCRYPT_ROUNDS);
    await db.pdvTerminal.update({ where: { id }, data: { secretHash } });
    return { token: `${id}.${secret}` };
  }

  async delete(tenantSlug: string, id: string) {
    const db = await this.tenantPrisma.getClient(tenantSlug);
    const current = await db.pdvTerminal.findUnique({ where: { id } });
    if (!current) throw new NotFoundException('PDV não encontrado.');
    if (current.activeDraftSaleId) {
      throw new BadRequestException('PDV com venda em andamento. Aguarde conclusão ou cancele.');
    }
    await db.pdvTerminal.delete({ where: { id } });
    return { ok: true };
  }

  async verifyToken(tenantSlug: string, terminalNumber: number, token: string) {
    const dot = token.indexOf('.');
    if (dot <= 0) throw new UnauthorizedException('Token de terminal inválido.');
    const id = token.slice(0, dot);
    const secret = token.slice(dot + 1);
    if (!secret) throw new UnauthorizedException('Token de terminal inválido.');

    const db = await this.tenantPrisma.getClient(tenantSlug);
    const row = await db.pdvTerminal.findFirst({
      where: { id, number: terminalNumber, isActive: true },
    });
    if (!row) throw new UnauthorizedException('Terminal não encontrado ou inativo.');
    const ok = await bcrypt.compare(secret, row.secretHash);
    if (!ok) throw new UnauthorizedException('Token de terminal inválido.');
    return row;
  }

  async touch(tenantSlug: string, terminalId: string) {
    const db = await this.tenantPrisma.getClient(tenantSlug);
    await db.pdvTerminal.update({
      where: { id: terminalId },
      data: { lastSeenAt: new Date() },
    });
  }

  async ensureCashSession(tenantSlug: string, terminal: { id: string; operatorUserId: string | null }) {
    const db = await this.tenantPrisma.getClient(tenantSlug);
    let userId = terminal.operatorUserId;
    if (!userId) {
      const fallback = await db.user.findFirst({
        where: { isActive: true, roles: { some: { name: 'seller' } } },
        orderBy: { createdAt: 'asc' },
      });
      userId = fallback?.id ?? null;
    }
    if (!userId) return null;

    const open = await db.cashRegisterSession.findFirst({
      where: { userId, status: CashSessionStatus.OPEN },
    });
    if (open) return open.id;

    const session = await db.cashRegisterSession.create({
      data: { userId, openingBalance: '0' },
    });
    return session.id;
  }

  async bootstrap(tenantSlug: string, terminalId: string): Promise<KioskBootstrap> {
    const db = await this.tenantPrisma.getClient(tenantSlug);
    const row = await db.pdvTerminal.findUnique({ where: { id: terminalId } });
    if (!row || !row.isActive) throw new NotFoundException('Terminal inativo.');

    await this.touch(tenantSlug, terminalId);
    const cashSessionId = await this.ensureCashSession(tenantSlug, row);

    await this.company.getOrCreate(tenantSlug);
    const settings = await this.paymentCredentials.getOrCreateSettings(tenantSlug);
    const pub = this.paymentCredentials.toPublic(tenantSlug, settings);

    return {
      terminal: this.toPublic(row),
      cashSessionId,
      payments: {
        mercadoPagoEnabled: pub.mercadoPagoEnabled,
        hasOnlinePix: pub.pixEnabled && (pub.hasGetnetCredentials || pub.hasMercadoPagoCredentials),
        hasPointIntegration: Boolean(row.mpPointTerminalId?.trim()),
        mercadoPagoPublicKey: pub.mercadoPagoPublicKey,
        activeProvider: pub.activeProvider,
        visibleProviders: [
          ...(pub.getnetEnabled && pub.hasGetnetCredentials ? (['GETNET'] as const) : []),
          ...(pub.mercadoPagoEnabled && pub.hasMercadoPagoCredentials
            ? (['MERCADO_PAGO'] as const)
            : []),
        ],
      },
    };
  }

  async completeKioskSale(
    tenantSlug: string,
    terminalId: string,
    userId: string,
    userRoles: string[],
    body: {
      items: Array<{ variantId: string; quantity: number; unitPrice: number }>;
      payments: Array<{
        method: PaymentMethod;
        amount: number;
        paymentFormName?: string;
        authCode?: string | null;
        paymentIntentId?: string | null;
      }>;
      cashSessionId?: string | null;
    },
  ) {
    const db = await this.tenantPrisma.getClient(tenantSlug);
    const terminal = await db.pdvTerminal.findUnique({ where: { id: terminalId } });
    if (!terminal || !terminal.isActive) {
      throw new NotFoundException('Terminal inativo.');
    }

    const allowed = new Set(this.parseAllowedMethods(terminal.allowedMethods));
    for (const p of body.payments) {
      if (p.method === PaymentMethod.CASH) {
        throw new BadRequestException('Dinheiro não permitido neste terminal.');
      }
      if (p.method === PaymentMethod.PIX && !allowed.has('PIX')) {
        throw new BadRequestException('PIX não permitido neste terminal.');
      }
      if (p.method === PaymentMethod.CARD) {
        const label = (p.paymentFormName ?? '').toLowerCase();
        const isDebit = label.includes('débito') || label.includes('debito');
        const key = isDebit ? 'CARD_DEBIT' : 'CARD_CREDIT';
        if (!allowed.has(key) && !allowed.has('CARD')) {
          throw new BadRequestException('Cartão não permitido neste terminal.');
        }
      }
    }

    if (terminal.activeDraftSaleId) {
      const draft = await db.sale.findUnique({ where: { id: terminal.activeDraftSaleId } });
      if (draft && draft.status === SaleStatus.DRAFT) {
        throw new ConflictException('Terminal com venda em andamento.');
      }
    }

    const cashSessionId =
      body.cashSessionId ??
      (await this.ensureCashSession(tenantSlug, { id: terminalId, operatorUserId: terminal.operatorUserId }));

    const paymentsResolved = await Promise.all(
      body.payments.map(async (p) => ({
        method: p.method,
        amount: p.amount,
        installments: 1,
        authCode: p.authCode ?? null,
        paymentIntentId: p.paymentIntentId ?? null,
        paymentFormId: await this.resolvePaymentFormId(db, p.method, p.paymentFormName),
      })),
    );

    const sale = await this.sales.create({
      tenantSlug,
      userId: terminal.operatorUserId ?? userId,
      userRoles,
      source: SaleSource.PDV,
      cashSessionId,
      terminalId,
      items: body.items,
      payments: paymentsResolved,
    });

    await db.pdvTerminal.update({
      where: { id: terminalId },
      data: { activeDraftSaleId: null, lastSeenAt: new Date() },
    });

    return sale;
  }

  private async resolvePaymentFormId(
    db: Awaited<ReturnType<TenantPrismaService['getClient']>>,
    method: PaymentMethod,
    paymentFormName?: string | null,
  ): Promise<string | null> {
    const label = paymentFormName?.trim();
    if (label) {
      const byName = await db.paymentForm.findFirst({
        where: { isActive: true, name: { equals: label, mode: 'insensitive' } },
      });
      if (byName) return byName.id;
    }
    const kind =
      method === PaymentMethod.PIX
        ? 'PIX'
        : method === PaymentMethod.CARD
          ? 'CARD'
          : null;
    if (!kind) return null;
    const fallback = await db.paymentForm.findFirst({
      where: { isActive: true, kind: kind as 'PIX' | 'CARD' },
      orderBy: { name: 'asc' },
    });
    return fallback?.id ?? null;
  }
}
