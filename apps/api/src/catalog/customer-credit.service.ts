import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { BillStatus, CreditKind, Prisma } from '../generated/tenant-client';
import { TenantPrismaService } from '../prisma/tenant-prisma.service';

export type CreditKindParam = 'CREDIT' | 'REQUISITION';

export type CustomerCreditSummary = {
  customerId: string;
  customerName: string;
  creditLimit: string;
  requisitionLimit: string;
  creditUsed: string;
  requisitionUsed: string;
  creditAvailable: string;
  requisitionAvailable: string;
};

export type CreditStatementLine = {
  date: string;
  description: string;
  items: Array<{
    description: string;
    quantity: string;
    unitPrice: string;
    totalLine: string;
  }>;
  quantity: string;
  total: string;
  saleNumber: number | null;
  saleId: string | null;
  receivableId: string;
  installmentLabel: string | null;
  amountRemaining: string;
  status: string;
  /** Saldo do limite após este movimento (ordem cronológica). */
  limitAfter: string;
};

export type CreditStatement = {
  kind: CreditKindParam;
  limit: string;
  used: string;
  available: string;
  lines: CreditStatementLine[];
};

function money(n: Prisma.Decimal | number | string): Prisma.Decimal {
  return n instanceof Prisma.Decimal ? n : new Prisma.Decimal(String(n));
}

function moneyStr(n: Prisma.Decimal): string {
  return n.toFixed(2);
}

@Injectable()
export class CustomerCreditService {
  constructor(private readonly tenantPrisma: TenantPrismaService) {}

  private parseKind(kind: string | undefined): CreditKind {
    const k = String(kind ?? '').toUpperCase();
    if (k === 'CREDIT') return CreditKind.CREDIT;
    if (k === 'REQUISITION') return CreditKind.REQUISITION;
    throw new BadRequestException('Informe kind=CREDIT ou kind=REQUISITION.');
  }

  /** Soma amountRemaining de títulos OPEN/OVERDUE do tipo. */
  async openUsed(
    tenantSlug: string,
    customerId: string,
    kind: CreditKind,
  ): Promise<Prisma.Decimal> {
    const db = await this.tenantPrisma.getClient(tenantSlug);
    const rows = await db.accountReceivable.findMany({
      where: {
        customerId,
        creditKind: kind,
        status: { in: [BillStatus.OPEN, BillStatus.OVERDUE] },
      },
      select: { amountRemaining: true },
    });
    return rows.reduce((s, r) => s.add(r.amountRemaining), new Prisma.Decimal(0));
  }

  async getSummary(tenantSlug: string, customerId: string): Promise<CustomerCreditSummary> {
    const db = await this.tenantPrisma.getClient(tenantSlug);
    const customer = await db.customer.findUnique({ where: { id: customerId } });
    if (!customer) throw new NotFoundException('Cliente não encontrado.');

    const [creditUsed, requisitionUsed] = await Promise.all([
      this.openUsed(tenantSlug, customerId, CreditKind.CREDIT),
      this.openUsed(tenantSlug, customerId, CreditKind.REQUISITION),
    ]);

    const creditLimit = money(customer.creditLimit);
    const requisitionLimit = money(customer.requisitionLimit);
    const creditAvailable = Prisma.Decimal.max(creditLimit.sub(creditUsed), new Prisma.Decimal(0));
    const requisitionAvailable = Prisma.Decimal.max(
      requisitionLimit.sub(requisitionUsed),
      new Prisma.Decimal(0),
    );

    return {
      customerId: customer.id,
      customerName: customer.name,
      creditLimit: moneyStr(creditLimit),
      requisitionLimit: moneyStr(requisitionLimit),
      creditUsed: moneyStr(creditUsed),
      requisitionUsed: moneyStr(requisitionUsed),
      creditAvailable: moneyStr(creditAvailable),
      requisitionAvailable: moneyStr(requisitionAvailable),
    };
  }

  async assertAvailable(
    tenantSlug: string,
    customerId: string,
    kind: CreditKind,
    amount: number | string | Prisma.Decimal,
  ): Promise<CustomerCreditSummary> {
    const summary = await this.getSummary(tenantSlug, customerId);
    const need = money(amount);
    const available =
      kind === CreditKind.CREDIT
        ? money(summary.creditAvailable)
        : money(summary.requisitionAvailable);
    const limit =
      kind === CreditKind.CREDIT ? money(summary.creditLimit) : money(summary.requisitionLimit);
    const label = kind === CreditKind.CREDIT ? 'crédito' : 'requisição';
    if (need.greaterThan(available)) {
      throw new BadRequestException(
        `Limite de ${label} insuficiente para ${summary.customerName}. ` +
          `Limite: R$ ${moneyStr(limit)}; disponível: R$ ${moneyStr(available)}; ` +
          `valor da venda: R$ ${moneyStr(need)}.`,
      );
    }
    return summary;
  }

  async getStatement(
    tenantSlug: string,
    customerId: string,
    kindRaw: string,
  ): Promise<CreditStatement> {
    const kind = this.parseKind(kindRaw);
    const db = await this.tenantPrisma.getClient(tenantSlug);
    const customer = await db.customer.findUnique({ where: { id: customerId } });
    if (!customer) throw new NotFoundException('Cliente não encontrado.');

    const limit =
      kind === CreditKind.CREDIT ? money(customer.creditLimit) : money(customer.requisitionLimit);
    const used = await this.openUsed(tenantSlug, customerId, kind);
    const available = Prisma.Decimal.max(limit.sub(used), new Prisma.Decimal(0));

    const receivables = await db.accountReceivable.findMany({
      where: { customerId, creditKind: kind },
      orderBy: [{ createdAt: 'asc' }, { dueDate: 'asc' }],
      include: {
        items: { orderBy: { createdAt: 'asc' } },
        sale: { select: { id: true, number: true } },
      },
    });

    let running = limit;
    const lines: CreditStatementLine[] = receivables.map((r) => {
      running = running.sub(r.amount);
      const items = r.items.map((it) => ({
        description: it.description,
        quantity: String(it.quantity),
        unitPrice: moneyStr(money(it.unitPrice)),
        totalLine: moneyStr(money(it.totalLine)),
      }));
      const qtySum = r.items.reduce((s, it) => s.add(it.quantity), new Prisma.Decimal(0));
      const installmentLabel =
        r.recurrenceIndex != null && r.recurrenceCount != null
          ? `${r.recurrenceIndex}/${r.recurrenceCount}`
          : null;
      return {
        date: r.createdAt.toISOString(),
        description: r.description,
        items,
        quantity: moneyStr(qtySum),
        total: moneyStr(money(r.amount)),
        saleNumber: r.sale?.number ?? null,
        saleId: r.sale?.id ?? null,
        receivableId: r.id,
        installmentLabel,
        amountRemaining: moneyStr(money(r.amountRemaining)),
        status: r.status,
        limitAfter: moneyStr(running),
      };
    });

    return {
      kind: kind === CreditKind.CREDIT ? 'CREDIT' : 'REQUISITION',
      limit: moneyStr(limit),
      used: moneyStr(used),
      available: moneyStr(available),
      lines: lines.reverse(), // mais recente primeiro na UI
    };
  }

  /** Enriquecer resultados de search com limites/disponíveis. */
  async enrichSearchRows(
    tenantSlug: string,
    rows: Array<{ id: string; name: string; document: string | null; phone: string | null }>,
  ) {
    if (!rows.length) return [];
    const db = await this.tenantPrisma.getClient(tenantSlug);
    const ids = rows.map((r) => r.id);
    const customers = await db.customer.findMany({
      where: { id: { in: ids } },
      select: { id: true, creditLimit: true, requisitionLimit: true },
    });
    const open = await db.accountReceivable.groupBy({
      by: ['customerId', 'creditKind'],
      where: {
        customerId: { in: ids },
        creditKind: { in: [CreditKind.CREDIT, CreditKind.REQUISITION] },
        status: { in: [BillStatus.OPEN, BillStatus.OVERDUE] },
      },
      _sum: { amountRemaining: true },
    });

    const limits = new Map(customers.map((c) => [c.id, c]));
    const usedMap = new Map<string, { credit: Prisma.Decimal; requisition: Prisma.Decimal }>();
    for (const id of ids) {
      usedMap.set(id, { credit: new Prisma.Decimal(0), requisition: new Prisma.Decimal(0) });
    }
    for (const g of open) {
      if (!g.customerId || !g.creditKind) continue;
      const slot = usedMap.get(g.customerId);
      if (!slot) continue;
      const sum = money(g._sum.amountRemaining ?? 0);
      if (g.creditKind === CreditKind.CREDIT) slot.credit = sum;
      else slot.requisition = sum;
    }

    return rows.map((r) => {
      const lim = limits.get(r.id);
      const used = usedMap.get(r.id)!;
      const creditLimit = money(lim?.creditLimit ?? 0);
      const requisitionLimit = money(lim?.requisitionLimit ?? 0);
      return {
        ...r,
        creditLimit: moneyStr(creditLimit),
        requisitionLimit: moneyStr(requisitionLimit),
        creditAvailable: moneyStr(
          Prisma.Decimal.max(creditLimit.sub(used.credit), new Prisma.Decimal(0)),
        ),
        requisitionAvailable: moneyStr(
          Prisma.Decimal.max(requisitionLimit.sub(used.requisition), new Prisma.Decimal(0)),
        ),
      };
    });
  }
}
