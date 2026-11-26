import {
  BadRequestException,
  Injectable,
} from '@nestjs/common';
import {
  CashMovementType,
  CashSessionStatus,
  PaymentMethod,
  SaleSource,
} from '../generated/tenant-client';
import { TenantPrismaService } from '../prisma/tenant-prisma.service';
import { getDefaultStockLocation, SalesService } from '../sales/sales.service';
import type { JwtPayload } from '../auth/strategies/jwt.strategy';

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const OFFLINE_METHODS = new Set<string>([
  PaymentMethod.CASH,
  PaymentMethod.PIX,
  PaymentMethod.CARD,
  PaymentMethod.OTHER,
]);

export type OfflineSaleBody = {
  clientSaleId: string;
  customerId?: string | null;
  cashSessionId?: string | null;
  receiptNote?: string | null;
  items: Array<{ variantId: string; quantity: number; unitPrice: number }>;
  payments: Array<{ method: string; amount: number }>;
};

export type OfflineCashBody = {
  clientId: string;
  type: 'IN' | 'OUT';
  amount: number;
  reason?: string | null;
  cashSessionId?: string | null;
};

@Injectable()
export class OfflineService {
  constructor(
    private readonly tenantPrisma: TenantPrismaService,
    private readonly sales: SalesService,
  ) {}

  async snapshot(user: JwtPayload) {
    const db = await this.tenantPrisma.getClient(user.tenantSlug);
    const location = await getDefaultStockLocation(db);
    const company = await db.company.findFirst({
      select: { id: true, tradeName: true, legalName: true, cnpj: true },
    });
    const variants = await db.productVariant.findMany({
      where: { product: { isActive: true } },
      take: 5000,
      orderBy: { product: { name: 'asc' } },
      select: {
        id: true,
        sku: true,
        barcode: true,
        retailPrice: true,
        product: { select: { name: true, isService: true, controlNumber: true } },
        stockBalances: {
          where: { locationId: location?.id ?? '00000000-0000-0000-0000-000000000000' },
          select: { quantity: true },
        },
      },
    });
    const customers = await db.customer.findMany({
      take: 5000,
      orderBy: { name: 'asc' },
      select: {
        id: true,
        name: true,
        document: true,
        creditLimit: true,
        requisitionLimit: true,
      },
    });
    const cash = await db.cashRegisterSession.findFirst({
      where: { userId: user.sub, status: CashSessionStatus.OPEN },
      select: { id: true, controlNumber: true, openedAt: true },
    });

    return {
      capturedAt: new Date().toISOString(),
      company: company
        ? {
            id: company.id,
            tradeName: company.tradeName,
            legalName: company.legalName,
            cnpj: company.cnpj,
          }
        : null,
      payments: ['CASH', 'PIX', 'CARD', 'OTHER'],
      cashSession: cash
        ? {
            id: cash.id,
            controlNumber: cash.controlNumber,
            openedAt: cash.openedAt.toISOString(),
          }
        : null,
      products: variants.map((v) => ({
        variantId: v.id,
        name: v.product.name,
        controlNumber: v.product.controlNumber,
        sku: v.sku,
        barcode: v.barcode,
        price: Number(v.retailPrice).toFixed(2),
        stockQty: v.product.isService
          ? 0
          : Number(v.stockBalances?.[0]?.quantity ?? 0),
        isService: v.product.isService,
      })),
      customers: customers.map((c) => ({
        id: c.id,
        name: c.name,
        document: c.document,
        creditLimit: Number(c.creditLimit).toFixed(2),
        requisitionLimit: Number(c.requisitionLimit).toFixed(2),
      })),
    };
  }

  async acceptSale(user: JwtPayload, body: OfflineSaleBody) {
    const clientSaleId = String(body.clientSaleId ?? '').trim().toLowerCase();
    if (!UUID_RE.test(clientSaleId)) {
      throw new BadRequestException('Identificador da venda local inválido.');
    }
    if (!Array.isArray(body.items) || body.items.length === 0) {
      throw new BadRequestException('A venda local não tem itens.');
    }
    if (!Array.isArray(body.payments) || body.payments.length === 0) {
      throw new BadRequestException('A venda local não tem pagamento.');
    }
    for (const p of body.payments) {
      if (!OFFLINE_METHODS.has(String(p.method))) {
        throw new BadRequestException('Forma de pagamento não aceita no modo local.');
      }
    }

    const externalRef = `off:${clientSaleId}`;
    const db = await this.tenantPrisma.getClient(user.tenantSlug);
    const existing = await db.sale.findFirst({
      where: { externalRef },
      select: { id: true, number: true, notes: true },
    });
    if (existing) {
      return {
        saleId: existing.id,
        number: existing.number,
        alreadySynced: true,
        stockConflict: (existing.notes ?? '').includes('[conferir estoque]'),
      };
    }

    const input = {
      tenantSlug: user.tenantSlug,
      userId: user.sub,
      userRoles: user.roles,
      customerId: body.customerId ?? null,
      cashSessionId: body.cashSessionId ?? null,
      receiptNote: body.receiptNote ?? null,
      source: SaleSource.PDV,
      externalRef,
      notes: 'Venda registrada no caixa sem internet.',
      items: body.items.map((it) => ({
        variantId: String(it.variantId),
        quantity: Number(it.quantity),
        unitPrice: Number(it.unitPrice),
      })),
      payments: body.payments.map((p) => ({
        method: p.method as PaymentMethod,
        amount: Number(p.amount),
      })),
    };

    try {
      const sale = await this.sales.create(input);
      return {
        saleId: sale.id,
        number: sale.number,
        alreadySynced: false,
        stockConflict: false,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : '';
      if (!message.includes('Estoque insuficiente')) throw err;
      const sale = await this.sales.create({
        ...input,
        offlineReplay: true,
        notes: 'Venda registrada no caixa sem internet. [conferir estoque]',
      });
      return {
        saleId: sale.id,
        number: sale.number,
        alreadySynced: false,
        stockConflict: true,
      };
    }
  }

  async acceptCash(user: JwtPayload, body: OfflineCashBody) {
    const clientId = String(body.clientId ?? '').trim().toLowerCase();
    if (!UUID_RE.test(clientId)) {
      throw new BadRequestException('Identificador do movimento inválido.');
    }
    if (body.type !== 'IN' && body.type !== 'OUT') {
      throw new BadRequestException('Tipo de movimento inválido.');
    }
    const amount = Number(body.amount);
    if (!Number.isFinite(amount) || amount <= 0) {
      throw new BadRequestException('Valor do movimento inválido.');
    }

    const tag = `[off:${clientId}]`;
    const db = await this.tenantPrisma.getClient(user.tenantSlug);
    const existing = await db.cashMovement.findFirst({
      where: { reason: { contains: tag } },
      select: { id: true },
    });
    if (existing) return { id: existing.id, alreadySynced: true };

    const sessionId = String(body.cashSessionId ?? '').trim();
    const session = sessionId
      ? await db.cashRegisterSession.findUnique({ where: { id: sessionId } })
      : await db.cashRegisterSession.findFirst({
          where: { userId: user.sub, status: CashSessionStatus.OPEN },
        });
    if (!session || session.status !== 'OPEN') {
      throw new BadRequestException('Caixa fechado — o movimento ficou pendente.');
    }
    if (session.userId !== user.sub && !user.roles.includes('admin') && !user.roles.includes('manager')) {
      throw new BadRequestException('Caixa de outro operador.');
    }

    const reason = `${tag} ${String(body.reason ?? '').trim()}`.trim().slice(0, 500);
    const created = await db.cashMovement.create({
      data: {
        sessionId: session.id,
        type: body.type === 'IN' ? CashMovementType.IN : CashMovementType.OUT,
        amount: amount.toFixed(2),
        method: PaymentMethod.CASH,
        reason,
      },
    });
    return { id: created.id, alreadySynced: false };
  }
}
